/**
 * The walk. Four properties are worth a test and none is visible in the code's
 * shape:
 *
 * 1. a month becomes country-days;
 * 2. a re-sweep converges — the same history read twice is the same rows,
 *    never a second copy;
 * 3. a truncated window is subdivided, and a window that is STILL truncated at
 *    the one-day floor is stored as partial rather than as whole;
 * 4. a Dawarich that does not answer leaves the cursors where they stood, and
 *    no log line carries a coordinate.
 *
 * Prisma is faked in memory rather than mocked call-by-call, because property 2
 * is about what the TABLE holds after two runs — an assertion on calls would
 * pass for an implementation that writes a duplicate row every night.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

interface StoredCountryDay {
  userId: string;
  source: string;
  date: Date;
  countryCode: string;
  pointCount: number;
  spanKm: number;
  partialWindow: boolean;
}

interface StoredState {
  userId: string;
  backfilledFromMonth: Date | null;
  backfillComplete: boolean;
  sweptThroughAt: Date | null;
  lastRunAt: Date | null;
  lastErrorKind: string | null;
  lastTruncatedAt: Date | null;
}

const db = {
  days: [] as StoredCountryDay[],
  states: new Map<string, StoredState>(),
};

const logLines: unknown[] = [];

interface DeleteArgs {
  where: { userId: string; source: string; date: { gte: Date; lt: Date } };
}
interface CreateArgs {
  data: StoredCountryDay[];
}
interface StateUpsertArgs {
  where: { userId: string };
  update: Partial<StoredState>;
  create: Partial<StoredState> & { userId: string };
}

jest.mock("../../../db", () => ({
  prisma: {
    countryDay: {
      deleteMany: async ({ where }: DeleteArgs) => {
        const before = db.days.length;
        db.days = db.days.filter(
          (row) =>
            !(
              row.userId === where.userId &&
              row.source === where.source &&
              row.date.getTime() >= where.date.gte.getTime() &&
              row.date.getTime() < where.date.lt.getTime()
            ),
        );
        return { count: before - db.days.length };
      },
      createMany: async ({ data }: CreateArgs) => {
        db.days.push(...data);
        return { count: data.length };
      },
    },
    dawarichSweepState: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        db.states.get(where.userId) ?? null,
      upsert: async ({ where, update, create }: StateUpsertArgs) => {
        const existing = db.states.get(where.userId);
        const next = existing
          ? { ...existing, ...update }
          : ({
              backfilledFromMonth: null,
              backfillComplete: false,
              sweptThroughAt: null,
              lastRunAt: null,
              lastErrorKind: null,
              lastTruncatedAt: null,
              ...create,
            } as StoredState);
        db.states.set(where.userId, next);
        return next;
      },
    },
    // The real client hands back lazy PrismaPromises; the fakes above are eager,
    // so awaiting them in order preserves delete-then-insert either way.
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  },
}));

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: {
    info: (...args: unknown[]) => logLines.push(args),
    warn: (...args: unknown[]) => logLines.push(args),
    error: (...args: unknown[]) => logLines.push(args),
    debug: (...args: unknown[]) => logLines.push(args),
  },
}));

import { sweepUserCountryDays, type CountryDaySweepDeps } from "../countryDaySweep";
import type { DawarichClient, DawarichPoint, DawarichPointsWindow } from "../dawarichClient";
import { DawarichError } from "../errors";

const USER = "user-1";
const NOW = new Date("2026-03-15T06:00:00.000Z");
const HOUR_MS = 3_600_000;

/** Distinctive enough that a coordinate leaking into a log is unmistakable. */
const TALLINN = { latitude: 59.4370111, longitude: 24.7535999 };
const RIGA = { latitude: 56.9496222, longitude: 24.1051888 };

const countryAt = (lat: number): string | null => (lat >= 58 ? "EE" : "LV");

function point(id: number, whenMs: number, where: { latitude: number; longitude: number }): DawarichPoint {
  return {
    id,
    latitude: where.latitude,
    longitude: where.longitude,
    timestampMs: whenMs,
    altitude: null,
    accuracy: null,
    velocity: null,
    trackId: null,
  };
}

const MARCH_3 = Date.UTC(2026, 2, 3);
const MARCH_4 = Date.UTC(2026, 2, 4);

const HISTORY: DawarichPoint[] = [
  point(1, MARCH_3 + 8 * HOUR_MS, TALLINN),
  point(2, MARCH_3 + 9 * HOUR_MS, TALLINN),
  point(3, MARCH_3 + 20 * HOUR_MS, RIGA),
  point(4, MARCH_4 + 10 * HOUR_MS, RIGA),
];

/** Answers a window from a fixed history, optionally always claiming truncation. */
function fakeClient(
  history: DawarichPoint[],
  options: { truncateWindowsLongerThanMs?: number } = {},
): DawarichClient & { calls: DawarichPointsWindow[] } {
  const calls: DawarichPointsWindow[] = [];
  return {
    calls,
    checkHealth: async () => ({ reachable: true as const, version: "1.9.2" }),
    getPoints: async (window: DawarichPointsWindow) => {
      calls.push(window);
      const points = history.filter(
        (p) =>
          p.timestampMs >= window.startAt.getTime() && p.timestampMs <= window.endAt.getTime(),
      );
      const span = window.endAt.getTime() - window.startAt.getTime();
      const truncated =
        options.truncateWindowsLongerThanMs !== undefined &&
        span > options.truncateWindowsLongerThanMs;
      return { points, truncated };
    },
  };
}

function deps(
  client: DawarichClient,
  overrides: Partial<CountryDaySweepDeps> = {},
): CountryDaySweepDeps {
  return {
    client,
    countryAt,
    now: NOW,
    // Forward-only by default: the backfill has its own tests and would
    // otherwise read 12 empty months into every assertion.
    maxMonthsWithData: 0,
    ...overrides,
  };
}

beforeEach(() => {
  db.days = [];
  db.states.clear();
  logLines.length = 0;
});

describe("sweepUserCountryDays", () => {
  it("turns a month of points into country-days", async () => {
    const client = fakeClient(HISTORY);

    const outcome = await sweepUserCountryDays(USER, deps(client));

    expect(outcome.errorKind).toBeNull();
    expect(outcome.monthsSwept).toBe(1);
    expect(
      db.days.map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        countryCode: row.countryCode,
        pointCount: row.pointCount,
        partialWindow: row.partialWindow,
      })),
    ).toEqual([
      { date: "2026-03-03", countryCode: "EE", pointCount: 2, partialWindow: false },
      { date: "2026-03-03", countryCode: "LV", pointCount: 1, partialWindow: false },
      { date: "2026-03-04", countryCode: "LV", pointCount: 1, partialWindow: false },
    ]);
  });

  /**
   * The property §8.4 needs and the one an upsert would fail: reading the same
   * history twice must leave the table saying the same thing, not saying it
   * twice. Storing a duplicate row per night is how a country-day table becomes
   * a country-day count.
   */
  it("re-sweeping the same history opens nothing new", async () => {
    await sweepUserCountryDays(USER, deps(fakeClient(HISTORY)));
    const first = JSON.stringify(db.days);

    await sweepUserCountryDays(USER, deps(fakeClient(HISTORY)));

    expect(db.days).toHaveLength(3);
    expect(JSON.stringify(db.days)).toBe(first);
  });

  /** A month the user has since deleted from Dawarich stops being a country. */
  it("withdraws a day Dawarich no longer reports", async () => {
    await sweepUserCountryDays(USER, deps(fakeClient(HISTORY)));
    expect(db.days).toHaveLength(3);

    await sweepUserCountryDays(USER, deps(fakeClient([HISTORY[0]])));

    expect(db.days).toHaveLength(1);
    expect(db.days[0].countryCode).toBe("EE");
  });

  it("subdivides a truncated window instead of storing what it happened to get", async () => {
    // A month truncates, a week does not.
    const client = fakeClient(HISTORY, { truncateWindowsLongerThanMs: 7 * 24 * HOUR_MS });

    const outcome = await sweepUserCountryDays(USER, deps(client));

    expect(client.calls.length).toBeGreaterThan(1);
    expect(outcome.partialDays).toBe(0);
    expect(db.days).toHaveLength(3);
    expect(db.days.every((row) => row.partialWindow === false)).toBe(true);
    expect(db.states.get(USER)?.lastTruncatedAt ?? null).toBeNull();
  });

  /**
   * The rule `dawarichClient.ts`'s own header states — a partial window must
   * not be recorded as a complete one. The day is still stored, because the
   * country WAS observed; what the flag withdraws is the day's silence.
   */
  it("marks a day whose window is still truncated at the one-day floor", async () => {
    const client = fakeClient(HISTORY, { truncateWindowsLongerThanMs: 0 });

    const outcome = await sweepUserCountryDays(USER, deps(client));

    expect(outcome.partialDays).toBeGreaterThan(0);
    expect(db.days).toHaveLength(3);
    expect(db.days.every((row) => row.partialWindow === true)).toBe(true);
    expect(db.states.get(USER)?.lastTruncatedAt).toBeInstanceOf(Date);
  });

  it("advances the cursor so the next night costs one window", async () => {
    await sweepUserCountryDays(USER, deps(fakeClient(HISTORY)));

    const state = db.states.get(USER);
    expect(state?.sweptThroughAt).toEqual(NOW);
    expect(state?.backfilledFromMonth).toEqual(new Date("2026-03-01T00:00:00.000Z"));

    const second = fakeClient(HISTORY);
    await sweepUserCountryDays(USER, deps(second));
    expect(second.calls).toHaveLength(1);
  });

  it("walks backwards a bounded number of months per run and remembers where it stopped", async () => {
    const client = fakeClient(HISTORY);

    const outcome = await sweepUserCountryDays(
      USER,
      deps(client, { maxMonthsWithData: 12, maxWindows: 4 }),
    );

    // One forward month plus three backwards, then the window budget stops it.
    expect(outcome.monthsSwept).toBe(4);
    expect(outcome.backfillComplete).toBe(false);
    expect(db.states.get(USER)?.backfilledFromMonth).toEqual(
      new Date("2025-12-01T00:00:00.000Z"),
    );
  });

  describe("when Dawarich does not answer", () => {
    const brokenClient = (): DawarichClient => ({
      checkHealth: async () => ({ reachable: true as const, version: null }),
      getPoints: async () => {
        throw new DawarichError("unreachable", "Dawarich is unreachable (/api/v1/points)");
      },
    });

    it("degrades to an outcome instead of throwing", async () => {
      const outcome = await sweepUserCountryDays(USER, deps(brokenClient()));

      expect(outcome.errorKind).toBe("unreachable");
      expect(outcome.monthsSwept).toBe(0);
    });

    it("leaves the cursors where they stood, so tomorrow resumes rather than restarts", async () => {
      await sweepUserCountryDays(USER, deps(brokenClient()));

      const state = db.states.get(USER);
      expect(state?.sweptThroughAt).toBeNull();
      expect(state?.backfilledFromMonth).toBeNull();
      expect(state?.lastErrorKind).toBe("unreachable");
    });
  });

  /**
   * The July concept's §3: location history is sensitive and never leaves the
   * backend. A log file is outside the backend the moment somebody pastes it
   * into an issue, so a coordinate in a log line is a leak — and the paths that
   * log at all are exactly the unhappy ones, where somebody is debugging.
   */
  it("never writes a coordinate into a log line", async () => {
    await sweepUserCountryDays(
      USER,
      deps(fakeClient(HISTORY, { truncateWindowsLongerThanMs: 0 })),
    );
    await sweepUserCountryDays("user-2", deps(brokenForLogs()));

    expect(logLines.length).toBeGreaterThan(0);
    const written = JSON.stringify(logLines);
    for (const coordinate of [
      String(TALLINN.latitude),
      String(TALLINN.longitude),
      String(RIGA.latitude),
      String(RIGA.longitude),
    ]) {
      expect(written).not.toContain(coordinate);
    }
    expect(written).not.toMatch(/latitude|longitude|lonlat/i);
  });
});

function brokenForLogs(): DawarichClient {
  return {
    checkHealth: async () => ({ reachable: true as const, version: null }),
    getPoints: async () => {
      throw new DawarichError("auth", "Dawarich rejected the API key", 401);
    },
  };
}
