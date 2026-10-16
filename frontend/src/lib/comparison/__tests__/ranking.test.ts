import { describe, it, expect } from "vitest";
import { rankPeople } from "../ranking";
import type { LeaderboardRow, RowStatus } from "../types";

function row(
  key: string,
  metrics: Record<string, number | null>,
  extra: { year?: number | null; domains?: string[]; partial?: string[] } = {},
  status: RowStatus = "ok"
): LeaderboardRow {
  return {
    person: {
      key,
      kind: key === "self" ? "self" : "local",
      username: key,
      displayName: key,
      origin: null,
    },
    status,
    sharedYear: null,
    snapshot:
      status === "ok"
        ? {
            schema: "travstats-leaderboard",
            version: 1,
            asOf: "2026-10-16T00:00:00.000Z",
            year: extra.year === undefined ? 2025 : extra.year,
            domains: extra.domains ?? ["flight"],
            metrics,
            partial: extra.partial ?? [],
          }
        : null,
  };
}

describe("rankPeople", () => {
  it("shares ranks on ties and never turns a missing value into zero", () => {
    const ranked = rankPeople(
      [
        row("self", { flights: 10 }),
        row("b", { flights: 10 }),
        row("c", { flights: 5 }),
        row("d", { flights: null }),
      ],
      "flights",
      2025
    );
    expect(ranked.map((e) => [e.row.person.key, e.rank])).toEqual([
      ["b", 1],
      ["self", 1],
      ["c", 3],
      ["d", null],
    ]);
    expect(ranked[3].reason).toBe("unknown");
    expect(ranked[3].value).toBeNull();
  });

  it("puts a real zero ahead of an unknown value", () => {
    const ranked = rankPeople(
      [row("self", { flights: null }), row("b", { flights: 0 })],
      "flights",
      2025
    );
    expect(ranked.map((e) => [e.row.person.key, e.rank])).toEqual([
      ["b", 1],
      ["self", null],
    ]);
  });

  it("ranks only the requested year and says why a row is unranked", () => {
    const ranked = rankPeople(
      [
        row("self", { flights: 1 }),
        row("old", { flights: 9 }, { year: 2024 }),
        row("quiet", {}),
        row("away", {}, {}, "unreachable"),
      ],
      "flights",
      2025
    );
    const why = Object.fromEntries(ranked.map((e) => [e.row.person.key, e.reason]));
    expect(why).toEqual({
      self: null,
      old: "otherYear",
      quiet: "metricNotShared",
      away: "unreachable",
    });
  });

  it("says a consented domain the person does not use is switched off, not withheld", () => {
    // ben consented to flights and cruises but tracks only flights: his server sends the cruise
    // figure as null and lists only "flight" among the domains it covers.
    const ranked = rankPeople(
      [
        row("self", { cruiseKm: 10 }, { domains: ["flight", "cruise"] }),
        row("ben", { cruiseKm: null }),
      ],
      "cruiseKm",
      2025
    );
    const ben = ranked.find((e) => e.row.person.key === "ben");
    expect(ben).toMatchObject({ value: null, rank: null, reason: "domainOff" });
  });

  it("compares cross-domain figures only between equal domain sets", () => {
    const ranked = rankPeople(
      [
        row("self", { daysAway: 40 }),
        row("rail", { daysAway: 90 }, { domains: ["flight", "rail"] }),
      ],
      "daysAway",
      2025
    );
    expect(ranked.find((e) => e.row.person.key === "rail")?.reason).toBe("notComparable");
  });

  it("ranks a lower bound and marks it partial", () => {
    const [first] = rankPeople(
      [row("self", { railKm: 10 }), row("b", { railKm: 50 }, { partial: ["railKm"] })],
      "railKm",
      2025
    );
    expect(first).toMatchObject({ rank: 1, partial: true, value: 50 });
  });
});
