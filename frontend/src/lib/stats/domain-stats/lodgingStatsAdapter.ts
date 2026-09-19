// Adapter: LodgingStats + Lodging[] -> DomainStats. Pure, sync.
//
// Mirrors adaptCruise's split: headline totals (nights, hotels, chains,
// countries) come straight from the already-computed `/stats/lodging`
// rollup so they can never drift from the backend's own numbers, while the
// per-day/weekday/year expansion needed for the cross-domain activity chart
// and heatmap is derived here from the raw stay list (the aggregate stats
// response doesn't carry day-level granularity).
import type { Lodging, LodgingStats } from "../../../types/lodging";
import { classifyLodging, classifyStay } from "../../../shared/lodgingCounting";
import { crossDomainDayKey } from "../../../shared/crossDomainCounting";
import type { DomainStats, YearSummary } from "./types";
import { bucket, topFive } from "./yearSummary";
import { toYearKeyed } from "./yearKeyed";

export interface LodgingAdapterInput {
  stats: LodgingStats;
  lodgings: Lodging[];
}

export function adaptLodging(input: LodgingAdapterInput): DomainStats {
  const { stats, lodgings } = input;

  if (stats.staysCount === 0) {
    return { domain: "lodging", hasData: false };
  }

  const yearlyEvents: Record<number, number> = {};
  const yearlyActiveDays: Record<number, number> = {};
  const monthlyActiveDays: Record<string, number> = {};
  const dailyEvents: Record<string, number> = {};
  const dailyActiveDays: Record<string, number> = {};
  const weekdayEvents: Record<number, number> = {};
  const chainCounts = new Map<string, number>();
  const perYear = new Map<
    number,
    { nights: number; lodgings: Set<string>; chains: Map<string, number> }
  >();

  for (const lodging of lodgings) {
    // Mirrors calculateLodgingStats: a house the user only bookmarked
    // contributes nothing, nor does one whose every stay is still ahead, nor
    // one whose every stay was cancelled — the cross-domain heatmap shows days
    // that HAPPENED.
    const stayStates = lodging.stays.map((s) =>
      classifyStay({
        status: s.status,
        checkIn: s.checkIn === null ? null : new Date(s.checkIn),
        checkOut: s.checkOut === null ? null : new Date(s.checkOut),
      })
    );
    if (classifyLodging(lodging, stayStates) === "excluded") continue;

    for (const [i, stay] of lodging.stays.entries()) {
      if (stayStates[i] !== "visited") continue;
      // This adapter expands stays into DAY buckets for the cross-domain
      // heatmap, so it needs real dates. An undated stay counts everywhere the
      // rollup counts it; here there is no day to mark.
      if (stay.checkIn === null || stay.checkOut === null) continue;

      const checkIn = new Date(stay.checkIn);
      if (Number.isNaN(checkIn.getTime())) continue;
      const checkOutRaw = new Date(stay.checkOut);
      const checkOut = Number.isNaN(checkOutRaw.getTime()) ? checkIn : checkOutRaw;

      const startYear = checkIn.getUTCFullYear();
      yearlyEvents[startYear] = (yearlyEvents[startYear] ?? 0) + 1;
      // Keyed on the check-in day — the same day the year tally counts it in.
      const checkInKey = crossDomainDayKey(
        startYear,
        checkIn.getUTCMonth() + 1,
        checkIn.getUTCDate()
      );
      dailyEvents[checkInKey] = (dailyEvents[checkInKey] ?? 0) + 1;
      weekdayEvents[checkIn.getUTCDay()] = (weekdayEvents[checkIn.getUTCDay()] ?? 0) + 1;

      if (lodging.chain?.name) {
        chainCounts.set(lodging.chain.name, (chainCounts.get(lodging.chain.name) ?? 0) + 1);
      }

      // The year of the check-in, as for `yearlyEvents`. Nights are whole UTC
      // days between check-in and check-out; a same-day stay has none.
      const y = bucket(perYear, startYear, () => ({
        nights: 0,
        lodgings: new Set<string>(),
        chains: new Map<string, number>(),
      }));
      const inDay = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
      const outDay = Date.UTC(
        checkOut.getUTCFullYear(),
        checkOut.getUTCMonth(),
        checkOut.getUTCDate()
      );
      y.nights += Math.max(0, Math.round((outDay - inDay) / 86_400_000));
      y.lodgings.add(lodging.id);
      if (lodging.chain?.name) {
        y.chains.set(lodging.chain.name, (y.chains.get(lodging.chain.name) ?? 0) + 1);
      }

      markActiveDays(checkIn, checkOut, dailyActiveDays, monthlyActiveDays, yearlyActiveDays);
    }
  }

  const summaryByYear: Record<number, YearSummary> = {};
  for (const [year, y] of perYear) {
    summaryByYear[year] = {
      headlineKpis: [
        { labelKey: "overviewCard.kpi.nights", value: y.nights },
        { labelKey: "overviewCard.kpi.lodgings", value: y.lodgings.size },
        { labelKey: "overviewCard.kpi.chains", value: y.chains.size },
      ],
      topItems: { titleKey: "overviewCard.topItems.chains", items: topFive(y.chains) },
    };
  }

  const topChains = [...chainCounts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([label, value]) => ({ label, value }));

  return {
    domain: "lodging",
    hasData: true,
    totalEvents: stats.staysCount,
    countries: stats.countries,
    // Without this index the overview's single-year tile fell back to the
    // lifetime set — "35 countries" under a "Year 2024" header (forgejo#80).
    countriesByYear: toYearKeyed(stats.countriesByYear),
    summaryByYear,
    yearlyEvents,
    dailyEvents,
    yearlyActiveDays,
    monthlyActiveDays,
    dailyActiveDays,
    weekdayEvents,
    summary: {
      headlineKpis: [
        { labelKey: "overviewCard.kpi.nights", value: stats.totalNights },
        { labelKey: "overviewCard.kpi.lodgings", value: stats.lodgingsCount },
        { labelKey: "overviewCard.kpi.chains", value: stats.chainsUnique },
      ],
      topItems: { titleKey: "overviewCard.topItems.chains", items: topChains },
      detailRoute: "/stats?tab=lodging",
    },
  };
}

/**
 * Active-day expansion mirrors `walkNights` in `utils/lodgingStats.ts` on
 * the backend: a night belongs to the calendar day it STARTS on (in UTC),
 * so the check-out day itself contributes no active day. A same-day
 * (0-night) stay still counts as one active day on its check-in date.
 */
function markActiveDays(
  checkIn: Date,
  checkOut: Date,
  dailyActiveDays: Record<string, number>,
  monthlyActiveDays: Record<string, number>,
  yearlyActiveDays: Record<number, number>
): void {
  const markOneDay = (cursorMs: number): void => {
    const d = new Date(cursorMs);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const ymdKey = `${y}-${m}-${day}`;
    if (!dailyActiveDays[ymdKey]) {
      dailyActiveDays[ymdKey] = 1;
      yearlyActiveDays[y] = (yearlyActiveDays[y] ?? 0) + 1;
      monthlyActiveDays[`${y}-${m}`] = (monthlyActiveDays[`${y}-${m}`] ?? 0) + 1;
    }
  };

  let cursor = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
  const end = Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate());

  if (cursor >= end) {
    markOneDay(cursor);
    return;
  }
  while (cursor < end) {
    markOneDay(cursor);
    cursor += 24 * 60 * 60 * 1000;
  }
}
