import { describe, it, expect } from "vitest";
import { funStats, rivalryLines, totalsOf, EARTH_CIRCUMFERENCE_KM } from "../funStats";
import { evaluateBadges, BADGES } from "../badges";
import { curatedProgress, curatedLead } from "../curatedProgress";
import type { LeaderboardRow, RowStatus } from "../types";

function row(metrics: Record<string, number | null>, status: RowStatus = "ok"): LeaderboardRow {
  return {
    person: { key: "x", kind: "local", username: "x", displayName: "x", origin: null },
    status,
    sharedYear: null,
    snapshot:
      status === "ok"
        ? {
            schema: "travstats-leaderboard",
            version: 1,
            asOf: "2026-11-25T00:00:00.000Z",
            year: null,
            domains: ["flight"],
            metrics,
            partial: [],
          }
        : null,
  };
}

describe("funStats", () => {
  it.each([
    [{ flightKm: 80_150, flightMinutes: 2880, flights: 10, nights: 365 }, 2, 20.85, 2, 2, 8015],
    [{ flightKm: 0, flightMinutes: 0, flights: 0, nights: 0 }, 0, 0, 0, 0, null],
  ])("derives from totals %#", (t, laps, moon, days, halves, avg) => {
    const s = funStats(t);
    expect(s.earthLaps).toBeCloseTo(laps, 1);
    expect(s.moonPercent).toBeCloseTo(moon, 1);
    expect(s.airDays).toBeCloseTo(days, 5);
    expect(s.nightsInHalfYears).toBeCloseTo(halves, 5);
    expect(s.avgFlightKm).toBe(avg);
  });
  it("is null where the input is null, and 0 flights has no average rather than 0 km", () => {
    const all = funStats({ flightKm: null, flightMinutes: null, flights: null, nights: null });
    expect(Object.values(all)).toEqual([null, null, null, null, null]);
    const noFlights = funStats({ flightKm: 100, flightMinutes: 60, flights: 0, nights: null });
    expect(noFlights.avgFlightKm).toBeNull();
    expect(noFlights.nightsInHalfYears).toBeNull();
    expect(noFlights.earthLaps).toBeCloseTo(100 / EARTH_CIRCUMFERENCE_KM, 6);
  });
  it("totalsOf an unanswered row or another year is all null", () => {
    expect(Object.values(totalsOf(row({}, "withdrawn"), null))).toEqual([null, null, null, null]);
    expect(totalsOf(row({ flights: 3 }), 2025).flights).toBeNull();
    expect(totalsOf(undefined, null).flightKm).toBeNull();
  });
});

describe("rivalryLines", () => {
  it("names who leads and by how much, only on numbers both sides have", () => {
    const lines = rivalryLines(
      { countries: 10, flights: null, nights: 50, places: 5 },
      { countries: 13, flights: 99, nights: 50, places: undefined }
    );
    expect(lines).toEqual([{ metric: "countries", ahead: "them", gap: 3 }]);
  });
});

describe("badges", () => {
  it.each(BADGES.map((b) => [b.code, b.metric, b.threshold] as const))(
    "%s: earned at the threshold, not one below",
    (code, metric, threshold) => {
      expect(evaluateBadges(row({ [metric]: threshold }), null)?.map((b) => b.code)).toContain(
        code
      );
      expect(
        evaluateBadges(row({ [metric]: threshold - 1 }), null)?.map((b) => b.code)
      ).not.toContain(code);
    }
  );
  it("a null total earns nothing and a missing row is unknown, not empty", () => {
    expect(evaluateBadges(row({ countries: null }), null)).toEqual([]);
    expect(evaluateBadges(row({}, "unreachable"), null)).toBeNull();
    expect(evaluateBadges(undefined, null)).toBeNull();
  });
});

describe("curated progress", () => {
  it("reads visited and size, and shows nothing for an old peer without the family", () => {
    const r = row({ curatedWorldHeritage: 23, curatedWorldHeritageOf: 1199 });
    expect(curatedProgress(r, "curatedWorldHeritage", null)).toEqual({ visited: 23, size: 1199 });
    expect(curatedProgress(row({ flights: 1 }), "curatedWorldHeritage", null)).toBeNull();
    expect(
      curatedProgress(row({ curatedWorldHeritage: null }), "curatedWorldHeritage", null)
    ).toBeNull();
    expect(
      curatedProgress(row({ curatedWorldHeritage: 5 }), "curatedWorldHeritage", null)
    ).toBeNull();
  });
  it("leads only between two real answers", () => {
    expect(curatedLead({ visited: 23, size: 1199 }, { visited: 41, size: 1199 })).toEqual({
      ahead: "them",
      gap: 18,
    });
    expect(curatedLead(null, { visited: 1, size: 2 })).toBeNull();
    expect(curatedLead({ visited: 1, size: 2 }, { visited: 1, size: 2 })).toBeNull();
  });
});
