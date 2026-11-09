// Adapter: counted tours -> DomainStats. Pure, sync.
//
// The rows are the server's `GET /stats/insights/tours/counted`: the tours that count
// (`shared/tour/tourCounting` — recorded, or dated before today at their place) in the year and
// on the day the server files them under, i.e. the very rows `crossDomainPopulations` reads for
// the evidence panel. A tour is one event on one day; a tour inside a trip is a tour and nothing
// else here (the roadtrip adapter reads roadtrips only), so it is never counted twice. A day tour
// proves no country in the passport, so this domain contributes none.
import type { CountedTour } from "../../../types/statsInsights";
import type { DomainKpi, DomainStats, YearSummary } from "./types";
import { bucket } from "./yearSummary";

export interface TourAdapterInput {
  tours: CountedTour[];
}

/** "No distance measured" is not 0 km: the KPI is left out, never zeroed. */
function kpis(count: number, km: number | null): DomainKpi[] {
  return [
    { labelKey: "overviewCard.kpi.tours", value: count },
    ...(km === null
      ? []
      : [{ labelKey: "overviewCard.kpi.distance", value: Math.round(km), unit: "km" as const }]),
  ];
}

const addKm = (sum: number | null, km: number | null): number | null =>
  km === null ? sum : (sum ?? 0) + km;

export function adaptTour(input: TourAdapterInput): DomainStats {
  const counted = input.tours;
  if (counted.length === 0) return { domain: "tour", hasData: false };

  const yearlyEvents: Record<number, number> = {};
  const yearlyActiveDays: Record<number, number> = {};
  const monthlyActiveDays: Record<string, number> = {};
  const dailyEvents: Record<string, number> = {};
  const dailyActiveDays: Record<string, number> = {};
  const weekdayEvents: Record<number, number> = {};
  const perYear = new Map<number, { count: number; km: number | null }>();
  let totalKm: number | null = null;

  for (const tour of counted) {
    totalKm = addKm(totalKm, tour.km);
    if (tour.year === null || tour.day === null) continue;
    yearlyEvents[tour.year] = (yearlyEvents[tour.year] ?? 0) + 1;
    dailyEvents[tour.day] = (dailyEvents[tour.day] ?? 0) + 1;
    const weekday = new Date(`${tour.day}T00:00:00Z`).getUTCDay();
    weekdayEvents[weekday] = (weekdayEvents[weekday] ?? 0) + 1;
    const y = bucket(perYear, tour.year, () => ({ count: 0, km: null as number | null }));
    y.count += 1;
    y.km = addKm(y.km, tour.km);
    if (dailyActiveDays[tour.day]) continue;
    dailyActiveDays[tour.day] = 1;
    yearlyActiveDays[tour.year] = (yearlyActiveDays[tour.year] ?? 0) + 1;
    const month = tour.day.slice(0, 7);
    monthlyActiveDays[month] = (monthlyActiveDays[month] ?? 0) + 1;
  }

  const summaryByYear: Record<number, YearSummary> = {};
  for (const [year, y] of perYear) summaryByYear[year] = { headlineKpis: kpis(y.count, y.km) };

  return {
    domain: "tour",
    hasData: true,
    totalEvents: counted.length,
    ...(totalKm === null ? {} : { totalDistanceKm: totalKm }),
    countries: [],
    countriesByYear: {},
    summaryByYear,
    yearlyEvents,
    dailyEvents,
    yearlyActiveDays,
    monthlyActiveDays,
    dailyActiveDays,
    weekdayEvents,
    summary: {
      headlineKpis: kpis(counted.length, totalKm),
      detailRoute: "/stats?tab=tour",
    },
  };
}
