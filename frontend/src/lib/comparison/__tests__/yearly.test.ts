import { describe, it, expect } from "vitest";
import { seriesPair, yearlyOf } from "../yearly";
import type { LeaderboardRow } from "../types";

const row = (
  years?: Record<string, Record<string, number | null>>,
  version: 2 | 3 = 3
): LeaderboardRow => ({
  person: { key: "x", kind: "local", username: "x", displayName: "x", origin: null },
  status: "ok",
  sharedYear: null,
  snapshot: {
    schema: "travstats-leaderboard",
    version,
    asOf: "2026-11-25T00:00:00.000Z",
    year: null,
    domains: ["flight"],
    metrics: {},
    partial: [],
    ...(years ? { years } : {}),
  },
});

describe("yearly series", () => {
  it("an old peer or a friend who did not opt in has no years", () => {
    expect(yearlyOf(row(undefined, 2))).toBeNull();
    expect(yearlyOf(row())).toBeNull();
    expect(yearlyOf(undefined)).toBeNull();
  });
  it("fills unlisted years with 0 but keeps a null figure as a gap", () => {
    const mine = yearlyOf(row({ "2022": { flights: 3 }, "2024": { flights: null } }));
    const theirs = yearlyOf(row({ "2023": { flights: 5 } }));
    const pair = seriesPair(mine, theirs, "flights");
    expect(pair?.mine.map((p) => p.value)).toEqual([3, 0, null]);
    expect(pair?.theirs.map((p) => p.value)).toEqual([0, 5, 0]);
  });
  it("draws nothing for a single year or a metric nobody has", () => {
    const one = yearlyOf(row({ "2024": { flights: 3 } }));
    expect(seriesPair(one, one, "flights")).toBeNull();
    const two = yearlyOf(row({ "2023": { flights: 1 }, "2024": { flights: 2 } }));
    expect(seriesPair(two, two, "nights")).toBeNull();
  });
});
