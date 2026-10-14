import { describe, it, expect } from "vitest";
import { rankRows, type ComparisonRow } from "../ranking";
import type { Snapshot } from "../../../lib/api/comparison";
const snapshot: Snapshot = {
  version: 1,
  definition: "travstats-comparison-1",
  asOf: "2026-10-13T00:00:00Z",
  year: 2026,
  precision: "exact",
  coverage: "all",
  domains: ["flight"],
  currency: "EUR",
  details: false,
  trips: [],
  metrics: { distance: 1000, flights: 1, minutes: 10, countries: null, daysAway: null, cost: null },
};
const row = (id: string, value: number | null, change: Partial<Snapshot> = {}): ComparisonRow => ({
  id,
  label: id,
  snapshot: { ...snapshot, metrics: { ...snapshot.metrics, distance: value }, ...change },
});
describe("friend leaderboard", () => {
  it("shares ranks for ties and never coerces withheld values to zero", () => {
    expect(
      rankRows([row("a", 10), row("b", 10), row("c", 5), row("d", null)], "distance", 2026).map(
        (r) => r.rank
      )
    ).toEqual([1, 1, 3, null]);
  });
  it("excludes partial coverage, wrong years and rounded estimates from an exact rank", () => {
    expect(
      rankRows(
        [
          row("a", 100, { coverage: "selection" }),
          row("b", 200, { year: 2025 }),
          row("c", 300, { precision: "rounded" }),
          row("d", 50),
        ],
        "distance",
        2026
      ).map((r) => [r.id, r.rank])
    ).toEqual([
      ["d", 1],
      ["a", null],
      ["b", null],
      ["c", null],
    ]);
  });
  it("does not rank a cost in another currency", () => {
    const a = row("a", 1),
      b = row("b", 1, { currency: "USD" });
    a.snapshot!.metrics.cost = 10;
    b.snapshot!.metrics.cost = 20;
    expect(rankRows([a, b], "cost", 2026, "EUR").map((r) => r.rank)).toEqual([1, null]);
  });
  it("does not rank multi-domain totals across different enabled domain sets", () => {
    const a = row("self", 1),
      b = row("b", 1, { domains: ["flight", "rail"] });
    a.snapshot!.metrics.daysAway = 10;
    b.snapshot!.metrics.daysAway = 20;
    expect(rankRows([a, b], "daysAway", 2026).map((r) => r.rank)).toEqual([1, null]);
  });
  it("keeps source rows unchanged", () => {
    const rows = [row("a", 1), row("b", 2)];
    rankRows(rows, "distance", 2026);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
