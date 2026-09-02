/**
 * Who gets swept, and what one bad account costs everyone else.
 *
 * Two properties here are load-bearing and neither is visible in the code's
 * shape: an account with no Dawarich connection of its own must cost nothing —
 * not a resolver call, not a decrypt, not a request — and one account's failure
 * must not end the night for the accounts after it.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

interface SettingsRow {
  userId: string;
  dawarichBaseUrl: string | null;
  dawarichApiKey: string | null;
}
interface FindManyArgs {
  where: Record<string, unknown>;
}

const findMany = jest.fn<(args: FindManyArgs) => Promise<SettingsRow[]>>();
const findManyArgs: FindManyArgs[] = [];

jest.mock("../../db", () => ({
  prisma: {
    userSettings: {
      findMany: (args: FindManyArgs) => {
        findManyArgs.push(args);
        return findMany(args);
      },
    },
  },
}));

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/** The boundary index is 10 MB of GeoJSON; a scheduling test must never load it. */
const getCountryResolver = jest.fn(async () => ({
  countryAt: () => null,
  codes: new Set<string>(),
  dataPath: "/dev/null",
}));
jest.mock("../../services/geo/countryFromCoordinates", () => ({
  getCountryResolver: () => getCountryResolver(),
}));

/**
 * Built from the account's own flights (§8.2). A scheduling test has no flight
 * table and does not need one — what matters here is WHO is swept, and the
 * airport rule is `services/countryDays/__tests__` business.
 */
jest.mock("../../services/countryDays/knownAirports", () => ({
  buildKnownAirportTest: async () => () => false,
}));

jest.mock("../../services/dawarich/dawarichResolver", () => ({
  buildUserDawarichConnection: (baseUrl: string | null, apiKey: string | null) =>
    baseUrl && apiKey ? { baseUrl, apiKey, source: "user" } : null,
}));

interface SweepOutcomeShape {
  userId: string;
  monthsSwept: number;
  windowsRequested: number;
  daysWritten: number;
  partialDays: number;
  backfillComplete: boolean;
  errorKind: string | null;
}
const sweepUserCountryDays = jest.fn<(userId: string) => Promise<SweepOutcomeShape>>();
jest.mock("../../services/dawarich/countryDaySweep", () => ({
  sweepUserCountryDays: (userId: string) => sweepUserCountryDays(userId),
}));

import { runDawarichCountryDaySweep } from "../dawarichCountryDaySweepScheduler";

const clean = (userId: string): SweepOutcomeShape => ({
  userId,
  monthsSwept: 1,
  windowsRequested: 1,
  daysWritten: 2,
  partialDays: 0,
  backfillComplete: true,
  errorKind: null,
});

const connected = (userId: string): SettingsRow => ({
  userId,
  dawarichBaseUrl: "https://dawarich.lan",
  dawarichApiKey: "encrypted",
});

/** Injected so no request can leave the process even if the code tried. */
const createClient = jest.fn(() => {
  throw new Error("the fake client should only be built for an eligible account");
});

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue([]);
  findManyArgs.length = 0;
  sweepUserCountryDays.mockReset();
  sweepUserCountryDays.mockImplementation(async (userId) => clean(userId));
  getCountryResolver.mockClear();
  createClient.mockClear();
});

describe("runDawarichCountryDaySweep", () => {
  it("sweeps every account that configured its own Dawarich connection", async () => {
    findMany.mockResolvedValue([connected("a"), connected("b")]);

    const result = await runDawarichCountryDaySweep({
      countryAt: () => null,
      createClient: () => ({}) as never,
    });

    expect(sweepUserCountryDays.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
    expect(result).toMatchObject({ users: 2, failed: 0, degraded: 0, daysWritten: 4 });
  });

  /**
   * Most instances have no Dawarich at all. "Costs nothing" is not a figure of
   * speech: the account is never enumerated, so nothing is decrypted, no
   * boundary file is read, and no request is built.
   */
  it("costs nothing on an instance where nobody has connected Dawarich", async () => {
    const result = await runDawarichCountryDaySweep({ createClient });

    expect(result.users).toBe(0);
    expect(sweepUserCountryDays).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(getCountryResolver).not.toHaveBeenCalled();
  });

  /** The filter is the mechanism, so it is asserted rather than assumed. */
  it("asks the database only for accounts that have both halves of a connection", async () => {
    await runDawarichCountryDaySweep({ createClient });

    expect(findManyArgs[0].where).toMatchObject({
      dawarichBaseUrl: { not: null },
      dawarichApiKey: { not: null },
    });
  });

  it("keeps going when one account's walk throws", async () => {
    findMany.mockResolvedValue([connected("a"), connected("b"), connected("c")]);
    sweepUserCountryDays
      .mockResolvedValueOnce(clean("a"))
      .mockRejectedValueOnce(new Error("the database went away"))
      .mockResolvedValueOnce(clean("c"));

    const result = await runDawarichCountryDaySweep({
      countryAt: () => null,
      createClient: () => ({}) as never,
    });

    expect(sweepUserCountryDays).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ users: 3, failed: 1, daysWritten: 4 });
  });

  /**
   * A Dawarich that did not answer is not a failure of this server, and an
   * operator reading the nightly line needs to see which of the two happened.
   */
  it("counts an unreachable Dawarich as degraded, not as failed", async () => {
    findMany.mockResolvedValue([connected("a")]);
    sweepUserCountryDays.mockResolvedValue({
      ...clean("a"),
      monthsSwept: 0,
      daysWritten: 0,
      errorKind: "unreachable",
    });

    const result = await runDawarichCountryDaySweep({
      countryAt: () => null,
      createClient: () => ({}) as never,
    });

    expect(result).toMatchObject({ users: 1, degraded: 1, failed: 0 });
  });

  it("skips an account whose stored connection no longer builds", async () => {
    findMany.mockResolvedValue([
      { userId: "a", dawarichBaseUrl: "https://dawarich.lan", dawarichApiKey: null },
      connected("b"),
    ]);

    const result = await runDawarichCountryDaySweep({
      countryAt: () => null,
      createClient: () => ({}) as never,
    });

    expect(sweepUserCountryDays.mock.calls.map(([id]) => id)).toEqual(["b"]);
    expect(result.users).toBe(1);
  });
});
