/**
 * The nightly sweep, which is the only reason the inbox ever fills for a user
 * who has not gone looking for it.
 *
 * Two properties are worth a test and neither is visible in the code's shape:
 * WHO gets looked at (the union, including the account that has nothing left
 * but an open flag), and that one account's failure does not end the night for
 * the accounts after it.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

import { runDataQualitySweep } from "../dataQualitySweepScheduler";

type UserGroup = { userId: string }[];
type RunSummary = {
  opened: number;
  reopened: number;
  updated: number;
  autoResolved: number;
  open: number;
};

const groupBy = {
  lodging: jest.fn<() => Promise<UserGroup>>(),
  place: jest.fn<() => Promise<UserGroup>>(),
  flag: jest.fn<() => Promise<UserGroup>>(),
  /** Every travel table the record checks read (forgejo#282, spec C3). */
  records: jest.fn<() => Promise<UserGroup>>(),
};

const runDataQualityChecks = jest.fn<(userId: string) => Promise<RunSummary>>();

jest.mock("../../db", () => ({
  prisma: {
    lodging: { groupBy: () => groupBy.lodging() },
    place: { groupBy: () => groupBy.place() },
    dataQualityFlag: { groupBy: () => groupBy.flag() },
    flight: { groupBy: () => groupBy.records() },
    railJourney: { groupBy: () => groupBy.records() },
    busJourney: { groupBy: () => groupBy.records() },
    ferryJourney: { groupBy: () => groupBy.records() },
    cruise: { groupBy: () => groupBy.records() },
  },
}));

jest.mock("../../services/dataQuality", () => ({
  runDataQualityChecks: (userId: string) => runDataQualityChecks(userId),
}));

const nothingFound: RunSummary = {
  opened: 0,
  reopened: 0,
  updated: 0,
  autoResolved: 0,
  open: 0,
};

beforeEach(() => {
  groupBy.lodging.mockResolvedValue([]);
  groupBy.place.mockResolvedValue([]);
  groupBy.flag.mockResolvedValue([]);
  groupBy.records.mockResolvedValue([]);
  runDataQualityChecks.mockReset();
  runDataQualityChecks.mockResolvedValue(nothingFound);
});

describe("runDataQualitySweep", () => {
  it("runs the checks once for every user with data, deduplicated across the sources", async () => {
    groupBy.lodging.mockResolvedValue([{ userId: "a" }, { userId: "b" }]);
    groupBy.place.mockResolvedValue([{ userId: "b" }, { userId: "c" }]);

    const result = await runDataQualitySweep();

    expect(runDataQualityChecks.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c"]);
    expect(result.users).toBe(3);
    expect(result.failed).toBe(0);
  });

  /**
   * The record checks (duplicates, overlaps, ferry matches) read flights and
   * rides, not just lodgings and places. An account with nothing but flights
   * was never swept, so its duplicate flights were never asked about.
   */
  it("visits an account that holds only flights or rides", async () => {
    groupBy.records.mockResolvedValue([{ userId: "flyer" }]);

    const result = await runDataQualitySweep();

    expect(runDataQualityChecks.mock.calls.map(([id]) => id)).toEqual(["flyer"]);
    expect(result.users).toBe(1);
  });

  /**
   * The account that has nothing left. Its lodging is deleted, so neither
   * groupBy over data names it — but the flag that lodging raised is still
   * open, and only a run can resolve it. Without this term the question
   * outlives the record for ever.
   */
  it("still visits an account whose only remaining trace is an open flag", async () => {
    groupBy.flag.mockResolvedValue([{ userId: "emptied" }]);
    runDataQualityChecks.mockResolvedValue({ ...nothingFound, autoResolved: 1 });

    const result = await runDataQualitySweep();

    expect(runDataQualityChecks).toHaveBeenCalledWith("emptied");
    expect(result.autoResolved).toBe(1);
  });

  it("keeps going when one account's checks throw", async () => {
    groupBy.lodging.mockResolvedValue([{ userId: "a" }, { userId: "b" }, { userId: "c" }]);
    runDataQualityChecks
      .mockResolvedValueOnce(nothingFound)
      .mockRejectedValueOnce(new Error("snapshot blew up"))
      .mockResolvedValueOnce({ ...nothingFound, opened: 2 });

    const result = await runDataQualitySweep();

    expect(runDataQualityChecks).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ users: 3, failed: 1, opened: 2, reopened: 0, autoResolved: 0 });
  });

  it("does nothing at all for an instance with no eligible account", async () => {
    const result = await runDataQualitySweep();

    expect(runDataQualityChecks).not.toHaveBeenCalled();
    expect(result.users).toBe(0);
  });
});
