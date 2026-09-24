// Adapter: RoadtripSummary[] -> DomainStats. Pure, sync.
//
// Everything here comes from the roadtrip list, which already carries each
// roadtrip's span, kilometres, nights and countries — derived on the server
// by the ONE night rule (`shared/tour/roadtrip.ts`) and the ONE station-country
// rule (`services/roadtrip/roadtripSummary.ts`). This file only buckets them.
//
// A roadtrip that has not started is planned and counts nowhere, the same
// line the server's cross-domain loader draws. An undated one counts in the
// lifetime figures and in no year, because it happened but the logbook does
// not say when.
import type { RoadtripSummary } from "../../../types/roadtrip";
import { crossDomainDayKey } from "../../../shared/crossDomainCounting";
import type { DomainStats, YearSummary } from "./types";
import { bucket, topFive } from "./yearSummary";

export interface RoadtripAdapterInput {
  roadtrips: RoadtripSummary[];
  /** Injected so tests can pin "now"; defaults to the real clock. */
  now?: Date;
}

const DAY_MS = 86_400_000;

function utcDay(iso: string): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function adaptRoadtrip(input: RoadtripAdapterInput): DomainStats {
  const now = (input.now ?? new Date()).getTime();
  const counted = input.roadtrips.filter(
    (r) => r.startDate === null || new Date(r.startDate).getTime() <= now
  );
  if (counted.length === 0) return { domain: "roadtrip", hasData: false };

  const yearlyEvents: Record<number, number> = {};
  const yearlyActiveDays: Record<number, number> = {};
  const monthlyActiveDays: Record<string, number> = {};
  const dailyEvents: Record<string, number> = {};
  const dailyActiveDays: Record<string, number> = {};
  const weekdayEvents: Record<number, number> = {};
  const countriesByYear: Record<number, string[]> = {};
  const countries = new Set<string>();
  const vehicles = new Map<string, number>();
  const perYear = new Map<number, { km: number; nights: number; countries: Set<string> }>();
  let totalKm = 0;
  let totalNights = 0;

  for (const r of counted) {
    totalKm += r.distanceKm;
    totalNights += r.nights;
    r.countries.forEach((c) => countries.add(c));
    if (r.vehicle) vehicles.set(r.vehicle, (vehicles.get(r.vehicle) ?? 0) + 1);
    if (!r.startDate) continue;

    const start = utcDay(r.startDate);
    const end = r.endDate ? utcDay(r.endDate) : start;
    const year = start.getUTCFullYear();
    yearlyEvents[year] = (yearlyEvents[year] ?? 0) + 1;
    const startKey = crossDomainDayKey(year, start.getUTCMonth() + 1, start.getUTCDate());
    dailyEvents[startKey] = (dailyEvents[startKey] ?? 0) + 1;
    weekdayEvents[start.getUTCDay()] = (weekdayEvents[start.getUTCDay()] ?? 0) + 1;

    const y = bucket(perYear, year, () => ({ km: 0, nights: 0, countries: new Set<string>() }));
    y.km += r.distanceKm;
    y.nights += r.nights;
    r.countries.forEach((c) => y.countries.add(c));

    for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
      const day = new Date(t);
      const dy = day.getUTCFullYear();
      const m = String(day.getUTCMonth() + 1).padStart(2, "0");
      const key = crossDomainDayKey(dy, day.getUTCMonth() + 1, day.getUTCDate());
      if (dailyActiveDays[key]) continue;
      dailyActiveDays[key] = 1;
      yearlyActiveDays[dy] = (yearlyActiveDays[dy] ?? 0) + 1;
      monthlyActiveDays[`${dy}-${m}`] = (monthlyActiveDays[`${dy}-${m}`] ?? 0) + 1;
    }
  }

  const summaryByYear: Record<number, YearSummary> = {};
  for (const [year, y] of perYear) {
    countriesByYear[year] = [...y.countries];
    summaryByYear[year] = {
      headlineKpis: [
        { labelKey: "overviewCard.kpi.distance", value: Math.round(y.km), unit: "km" },
        { labelKey: "overviewCard.kpi.roadtripNights", value: y.nights },
        { labelKey: "overviewCard.kpi.countries", value: y.countries.size },
      ],
    };
  }

  return {
    domain: "roadtrip",
    hasData: true,
    totalEvents: counted.length,
    totalDistanceKm: totalKm,
    countries: [...countries],
    countriesByYear,
    summaryByYear,
    yearlyEvents,
    dailyEvents,
    yearlyActiveDays,
    monthlyActiveDays,
    dailyActiveDays,
    weekdayEvents,
    summary: {
      headlineKpis: [
        { labelKey: "overviewCard.kpi.distance", value: Math.round(totalKm), unit: "km" },
        { labelKey: "overviewCard.kpi.roadtripNights", value: totalNights },
        { labelKey: "overviewCard.kpi.countries", value: countries.size },
      ],
      topItems:
        vehicles.size > 0
          ? {
              titleKey: "overviewCard.topItems.vehicles",
              items: topFive(vehicles),
              labelKeyPrefix: "roadtrips:vehicle",
            }
          : undefined,
      detailRoute: "/stats?tab=roadtrip",
    },
  };
}
