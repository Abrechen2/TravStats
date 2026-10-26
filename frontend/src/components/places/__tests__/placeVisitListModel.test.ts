import { describe, expect, it } from "vitest";

import { buildVisitList, type BuildOptions } from "../placeVisitListModel";
import { visitAt } from "./visitFixtures";

// Monday 26 October 2026, 09:00 in Berlin (CET, UTC+1 since the 25th).
const NOW = new Date("2026-10-26T08:00:00.000Z");
const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({
  now: NOW,
  fallbackZone: "Europe/Berlin",
  filter: "all",
  pastLimit: 50,
  ...over,
});
const ids = (entries: { visit: { id: string } }[]): string[] => entries.map((e) => e.visit.id);

const VISITS = [
  visitAt("past-2025", "2025-11-14T18:30:00.000Z"),
  visitAt("next-week", "2026-11-06T18:30:00.000Z"),
  visitAt("undated", null),
  visitAt("feb", "2026-02-27T12:30:00.000Z"),
  visitAt("thursday", "2026-10-29T12:30:00.000Z"),
  // Known only to the day: stored at the day's start at the place.
  visitAt("jan-day", "2026-01-15T23:00:00.000Z", { precision: "day" }),
];

describe("buildVisitList — order and groups", () => {
  it("puts planned visits first, next one first; the past by year, newest first; undated last", () => {
    const { groups } = buildVisitList(VISITS, opts());
    expect(groups.map((g) => (g.kind === "year" ? g.year : g.kind))).toEqual([
      "planned",
      "2026",
      "2025",
      "undated",
    ]);
    expect(ids(groups[0].entries)).toEqual(["thursday", "next-week"]);
    expect(ids(groups[1].entries)).toEqual(["feb", "jan-day"]);
    expect(ids(groups[2].entries)).toEqual(["past-2025"]);
    expect(ids(groups[3].entries)).toEqual(["undated"]);
  });

  it("gives a day-only visit no clock and a timed one its clock at the place", () => {
    const { groups } = buildVisitList(VISITS, opts());
    const [feb, janDay] = groups[1].entries;
    expect(feb.day).toBe("2026-02-27");
    expect(feb.clock).toBe("13:30");
    expect(janDay.day).toBe("2026-01-16");
    expect(janDay.clock).toBeNull();
  });

  it("counts days ahead on the place's calendar", () => {
    const { groups } = buildVisitList(VISITS, opts());
    expect(groups[0].entries.map((e) => e.daysAhead)).toEqual([3, 11]);
  });

  it("summarises: visited incl. undated, last, first dated, next", () => {
    const { summary, counts } = buildVisitList(VISITS, opts());
    expect(counts).toEqual({ total: 6, visited: 4, planned: 2 });
    expect(summary.visited).toBe(4);
    expect(summary.last?.visit.id).toBe("feb");
    expect(summary.firstDated?.visit.id).toBe("past-2025");
    expect(summary.next?.visit.id).toBe("thursday");
  });
});

describe("buildVisitList — today", () => {
  const today = [
    // 26 Oct, day only: stored as 00:00 Berlin = 25 Oct 23:00 UTC.
    visitAt("today-day", "2026-10-25T23:00:00.000Z", { precision: "day" }),
    visitAt("this-morning", "2026-10-26T06:00:00.000Z"),
    visitAt("tonight", "2026-10-26T18:30:00.000Z"),
  ];

  it("keeps a day-only visit today planned while the day lasts — the instant alone said 'over' at midnight", () => {
    const { groups } = buildVisitList(today, opts());
    expect(groups[0].kind).toBe("planned");
    expect(ids(groups[0].entries)).toEqual(["today-day", "tonight"]);
    expect(groups[0].entries.map((e) => e.daysAhead)).toEqual([0, 0]);
    expect(ids(groups[1].entries)).toEqual(["this-morning"]);
  });

  it("still planned at 23:30 at the place, done at 00:30 the next day", () => {
    const late = buildVisitList(today, opts({ now: new Date("2026-10-26T22:30:00.000Z") }));
    expect(ids(late.groups[0].entries)).toEqual(["today-day"]);
    const after = buildVisitList(today, opts({ now: new Date("2026-10-26T23:30:00.000Z") }));
    expect(after.counts.planned).toBe(0);
  });

  it("reads 'today' at the place, not in UTC: Tokyo's day ends nine hours earlier", () => {
    const tokyo = [
      visitAt("tokyo-day", "2026-10-25T15:00:00.000Z", { precision: "day", zone: "Asia/Tokyo" }),
    ];
    // 26 Oct 15:30 UTC is 27 Oct 00:30 in Tokyo — the day is over there.
    const { counts } = buildVisitList(tokyo, opts({ now: new Date("2026-10-26T15:30:00.000Z") }));
    expect(counts.planned).toBe(0);
  });
});

describe("buildVisitList — filter and paging", () => {
  it("'visited' shows the past and undated, never a plan", () => {
    const { groups } = buildVisitList(VISITS, opts({ filter: "visited" }));
    expect(groups.map((g) => g.kind)).toEqual(["year", "year", "undated"]);
  });

  it("'planned' shows plans only", () => {
    const { groups, hiddenPast } = buildVisitList(VISITS, opts({ filter: "planned" }));
    expect(groups.map((g) => g.kind)).toEqual(["planned"]);
    expect(hiddenPast).toBe(0);
  });

  it("renders the newest past visits up to the limit and counts the rest", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      visitAt(
        `v${String(i).padStart(2, "0")}`,
        new Date(Date.UTC(2020, 0, 1 + i * 30)).toISOString()
      )
    );
    const model = buildVisitList(many, opts({ pastLimit: 50 }));
    const shown = model.groups.flatMap((g) => ids(g.entries));
    expect(shown).toHaveLength(50);
    expect(shown[0]).toBe("v59");
    expect(model.hiddenPast).toBe(10);
    // Summary counts the whole history, not the page.
    expect(model.summary.firstDated?.visit.id).toBe("v00");
    expect(model.summary.visited).toBe(60);
  });
});
