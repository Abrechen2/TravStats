import { describe, expect, it } from "vitest";
import { adaptLodging } from "../lodgingStatsAdapter";
import { resolveStayTiming } from "../../../../shared/lodgingTiming";
import { classifyStay } from "../../../../shared/lodgingCounting";
import type { Lodging, LodgingStats, LodgingStay } from "../../../../types/lodging";
import { EMPTY_LODGING_STATS_BLOCKS } from "../../../../types/lodgingStatsFixture";

/**
 * The year summary counts the same nights the list does.
 *
 * Found while auditing the lodging list's move to server-side paging
 * (2026-09-20). The question that sweep asked of every consumer was: could
 * this figure and the one the database computes disagree? For the list's own
 * rows and its summary strip the answer is no, and two tests pin it. For THIS
 * adapter the answer was yes, and by a lot.
 *
 * It differenced `checkOut - checkIn` itself instead of asking
 * `shared/lodgingTiming.ts`. A MONTH-precision stay ("July 2011, three
 * nights") stores placeholder dates spanning the whole month, so the
 * subtraction returned THIRTY, while the same stay reads as three everywhere
 * else — on its row, in the list's summary, in `/stats/lodging` and in the
 * heatmap's own source of truth. That is the defect AUD-083 named, one module
 * further along: "walking them produced 32 exact days of presence out of a
 * stay the same record says was three nights long".
 *
 * So the rule has one home and this file asks it. The cases below are the two
 * that differ — a placeholder span, and a real one — measured against the
 * shared rule rather than against a number typed in here.
 */

const stay = (over: Partial<LodgingStay>): LodgingStay =>
  ({
    id: `s-${over.checkIn ?? "x"}`,
    status: "completed",
    datePrecision: "DAY",
    nights: null,
    checkIn: null,
    checkOut: null,
    ...over,
  }) as unknown as LodgingStay;

const house = (id: string, stays: LodgingStay[]): Lodging =>
  ({ id, name: id, visited: true, chain: null, stays }) as unknown as Lodging;

const statsFor = (staysCount: number): LodgingStats =>
  ({
    lodgingsCount: 1,
    staysCount,
    totalNights: 0,
    ...EMPTY_LODGING_STATS_BLOCKS,
  }) as unknown as LodgingStats;

/** The answer the shared rule gives for the stays that COUNT. */
const nightsByTheRule = (lodgings: Lodging[]): number =>
  lodgings
    .flatMap((l) => l.stays)
    .filter(
      (s) =>
        classifyStay({
          status: s.status,
          checkIn: s.checkIn === null ? null : new Date(s.checkIn),
          checkOut: s.checkOut === null ? null : new Date(s.checkOut),
        }) === "visited"
    )
    .reduce(
      (sum, s) =>
        sum +
        resolveStayTiming({
          checkIn: s.checkIn === null ? null : new Date(s.checkIn),
          checkOut: s.checkOut === null ? null : new Date(s.checkOut),
          datePrecision: s.datePrecision ?? "DAY",
          nights: s.nights ?? null,
        }).nights,
      0
    );

const yearNights = (lodgings: Lodging[], year: number): number => {
  const adapted = adaptLodging({ stats: statsFor(lodgings.length), lodgings });
  const kpis = adapted.hasData === false ? [] : (adapted.summaryByYear?.[year]?.headlineKpis ?? []);
  const value = kpis.find((k) => k.labelKey === "overviewCard.kpi.nights")?.value;
  // -1 for "no bucket for that year at all", which is a different answer from 0.
  return typeof value === "number" ? value : -1;
};

describe("adaptLodging — nights per year", () => {
  it("counts a DAY-precision stay by its dates, as the shared rule does", () => {
    const lodgings = [
      house("l1", [
        stay({ checkIn: "2024-05-01T00:00:00.000Z", checkOut: "2024-05-04T00:00:00.000Z" }),
      ]),
    ];
    expect(yearNights(lodgings, 2024)).toBe(nightsByTheRule(lodgings));
    expect(yearNights(lodgings, 2024)).toBe(3);
  });

  it("does not difference a MONTH-precision stay's placeholder dates", () => {
    // "July 2011, three nights": stored as the 1st to the 31st because that is
    // what the month spans. Subtracting them invents twenty-seven nights the
    // record never claimed.
    const lodgings = [
      house("l2", [
        stay({
          checkIn: "2011-07-01T00:00:00.000Z",
          checkOut: "2011-07-31T00:00:00.000Z",
          datePrecision: "MONTH",
          nights: 3,
        }),
      ]),
    ];
    expect(yearNights(lodgings, 2011)).toBe(nightsByTheRule(lodgings));
    expect(yearNights(lodgings, 2011)).toBe(3);
  });

  it("counts a YEAR-precision stay by what the record says, not by the calendar", () => {
    const lodgings = [
      house("l3", [
        stay({
          checkIn: "2019-01-01T00:00:00.000Z",
          checkOut: "2019-12-31T00:00:00.000Z",
          datePrecision: "YEAR",
          nights: 2,
        }),
      ]),
    ];
    expect(yearNights(lodgings, 2019)).toBe(nightsByTheRule(lodgings));
  });

  it("leaves a stay that has not happened out of the count entirely", () => {
    const lodgings = [
      house("l4", [
        stay({
          status: "scheduled",
          checkIn: "2099-03-01T00:00:00.000Z",
          checkOut: "2099-03-10T00:00:00.000Z",
        }),
      ]),
    ];
    // No bucket at all, rather than a year holding zero: the rule says this
    // stay has not happened, and a year summary for it would be a year the
    // account has no record in.
    expect(yearNights(lodgings, 2099)).toBe(-1);
    expect(nightsByTheRule(lodgings)).toBe(0);
  });
});
