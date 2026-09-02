/**
 * The seam itself, apart from the routes that use it.
 *
 * Two properties, both of which exist because of how `runDataQualityChecks` is
 * built rather than how this file is: it never rejects (the caller is an import
 * that has already succeeded), and two runs for one account never overlap (the
 * runner reads-then-creates without a transaction, so an overlap makes the
 * loser hit the unique index and abandon its pass).
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

import { triggerDataQualityChecks } from "../dataQualityTrigger";

type RunSummary = {
  opened: number;
  reopened: number;
  updated: number;
  autoResolved: number;
  open: number;
};

const runDataQualityChecks = jest.fn<(userId: string) => Promise<RunSummary>>();

jest.mock("../dataQuality", () => ({
  runDataQualityChecks: (userId: string) => runDataQualityChecks(userId),
}));

const nothingFound: RunSummary = {
  opened: 0,
  reopened: 0,
  updated: 0,
  autoResolved: 0,
  open: 0,
};

const context = { trigger: "place_import" as const, batchId: "batch-1" };

beforeEach(() => {
  runDataQualityChecks.mockReset();
  runDataQualityChecks.mockResolvedValue(nothingFound);
});

describe("triggerDataQualityChecks", () => {
  it("resolves rather than rejecting when the checks throw", async () => {
    runDataQualityChecks.mockRejectedValue(new Error("snapshot blew up"));

    await expect(triggerDataQualityChecks("u1", context)).resolves.toBeUndefined();
  });

  it("runs one account's checks one at a time, and still runs every one of them", async () => {
    let running = 0;
    let maxConcurrent = 0;
    runDataQualityChecks.mockImplementation(async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
      return nothingFound;
    });

    await Promise.all([
      triggerDataQualityChecks("u1", context),
      triggerDataQualityChecks("u1", { ...context, batchId: "batch-2" }),
      triggerDataQualityChecks("u1", { ...context, batchId: "batch-3" }),
    ]);

    expect(maxConcurrent).toBe(1);
    // Queued, never dropped: the second import's rows did not exist when the
    // first run started, so skipping it would push them to the nightly sweep.
    expect(runDataQualityChecks).toHaveBeenCalledTimes(3);
  });

  it("does not serialise across accounts", async () => {
    let running = 0;
    let maxConcurrent = 0;
    runDataQualityChecks.mockImplementation(async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
      return nothingFound;
    });

    await Promise.all([
      triggerDataQualityChecks("u1", context),
      triggerDataQualityChecks("u2", context),
    ]);

    expect(maxConcurrent).toBe(2);
  });

  it("keeps serialising after a run has thrown", async () => {
    runDataQualityChecks
      .mockRejectedValueOnce(new Error("snapshot blew up"))
      .mockResolvedValueOnce(nothingFound);

    await Promise.all([
      triggerDataQualityChecks("u1", context),
      triggerDataQualityChecks("u1", { ...context, batchId: "batch-2" }),
    ]);

    // A failed link must not poison the chain — the queued run still happened.
    expect(runDataQualityChecks).toHaveBeenCalledTimes(2);
  });
});
