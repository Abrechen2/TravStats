// Adapter: BusJourney[] -> DomainStats. Pure, sync.
//
// The bus counterpart of adaptRail (forgejo#263/#265, spec 2026-10-07 §6 D4):
// a completed coach ride is one experience, filed on its departure terminal's
// calendar, active on its departure and — for a ride overnight — its arrival
// day, and it proves both terminals' countries. Every one of those rules is
// `shared/busCounting`, which the server's `crossDomainPopulations.loadBus`
// asks too, so the card and the evidence panel cannot disagree.
//
// It is ONE domain beside the others in the overview's folds
// (`shared/crossDomainCounting`): its rides add events, its countries and days
// are unioned with the other domains', so a trip's flight and the coach after
// it on the same day are one active day and one country, never two.
//
// Distance is split by what it measures: the straight line between terminals
// understates a road by 10-40 %, so it is never added silently to a routed or
// ticket figure under one "distance" label.
import type { BusJourney } from "../../../types/bus";
import { busCountries, busDayKeys, busYear, isCountableBus } from "../../../shared/busCounting";
import type { DomainKpi, DomainStats, YearSummary } from "./types";
import { bucket, topFive } from "./yearSummary";

export interface BusAdapterInput {
  journeys: BusJourney[];
}

type BusRide = Pick<
  BusJourney,
  | "status"
  | "departureTime"
  | "arrivalTime"
  | "depTimezone"
  | "arrTimezone"
  | "depCountry"
  | "arrCountry"
  | "distanceKm"
  | "distanceSource"
  | "operator"
>;

interface Km {
  straight: number;
  measured: number;
}

function addKm(km: Km, ride: BusRide): void {
  if (ride.distanceKm === null) return;
  if (ride.distanceSource === "great_circle") km.straight += ride.distanceKm;
  else km.measured += ride.distanceKm;
}

/**
 * The distance KPIs, one per kind that exists. A user with only straight-line
 * rides sees "km (straight line)" and nothing pretending to be the road.
 */
function kmKpis(km: Km): DomainKpi[] {
  return [
    ...(km.measured > 0
      ? [
          {
            labelKey: "overviewCard.kpi.busKmMeasured",
            value: Math.round(km.measured),
            unit: "km" as const,
          },
        ]
      : []),
    ...(km.straight > 0
      ? [
          {
            labelKey: "overviewCard.kpi.busKmStraight",
            value: Math.round(km.straight),
            unit: "km" as const,
          },
        ]
      : []),
  ];
}

export function adaptBus(input: BusAdapterInput): DomainStats {
  const rides: BusRide[] = input.journeys.filter((j) => isCountableBus(j));
  if (rides.length === 0) return { domain: "bus", hasData: false };

  const countries = new Set<string>();
  const operators = new Map<string, number>();
  const km: Km = { straight: 0, measured: 0 };
  const yearlyEvents: Record<number, number> = {};
  const yearlyActiveDays: Record<number, number> = {};
  const monthlyActiveDays: Record<string, number> = {};
  const dailyEvents: Record<string, number> = {};
  const dailyActiveDays: Record<string, number> = {};
  const weekdayEvents: Record<number, number> = {};
  const countriesByYear: Record<number, Set<string>> = {};
  const perYear = new Map<number, { rides: number; km: Km; operators: Map<string, number> }>();
  let hours = 0;

  for (const ride of rides) {
    const year = busYear(ride);
    const days = busDayKeys(ride);
    const departureDay = days[0];
    const rideCountries = busCountries(ride);

    yearlyEvents[year] = (yearlyEvents[year] ?? 0) + 1;
    // Keyed on the departure day, as the year is: one ride, one event, on the
    // day it left — on its terminal's calendar, not the reader's.
    dailyEvents[departureDay] = (dailyEvents[departureDay] ?? 0) + 1;
    const weekday = new Date(`${departureDay}T00:00:00Z`).getUTCDay();
    weekdayEvents[weekday] = (weekdayEvents[weekday] ?? 0) + 1;
    for (const day of days) {
      if (dailyActiveDays[day]) continue;
      dailyActiveDays[day] = 1;
      const dayYear = Number(day.slice(0, 4));
      yearlyActiveDays[dayYear] = (yearlyActiveDays[dayYear] ?? 0) + 1;
      monthlyActiveDays[day.slice(0, 7)] = (monthlyActiveDays[day.slice(0, 7)] ?? 0) + 1;
    }

    for (const c of rideCountries) {
      countries.add(c);
      (countriesByYear[year] ??= new Set()).add(c);
    }
    addKm(km, ride);
    const y = bucket(perYear, year, () => ({
      rides: 0,
      km: { straight: 0, measured: 0 },
      operators: new Map<string, number>(),
    }));
    y.rides += 1;
    addKm(y.km, ride);
    const operator = ride.operator?.trim();
    if (operator) {
      operators.set(operator, (operators.get(operator) ?? 0) + 1);
      y.operators.set(operator, (y.operators.get(operator) ?? 0) + 1);
    }
    // Hours only where both instants are known; an open arrival is no length.
    if (ride.arrivalTime) {
      const ms = new Date(ride.arrivalTime).getTime() - new Date(ride.departureTime).getTime();
      if (ms >= 0) hours += ms / 3_600_000;
    }
  }

  const summaryByYear: Record<number, YearSummary> = {};
  for (const [year, y] of perYear) {
    summaryByYear[year] = {
      headlineKpis: [
        { labelKey: "overviewCard.kpi.busRides", value: y.rides },
        ...kmKpis(y.km),
        { labelKey: "overviewCard.kpi.countries", value: countriesByYear[year]?.size ?? 0 },
      ],
      topItems: { titleKey: "overviewCard.topItems.busOperators", items: topFive(y.operators) },
    };
  }

  return {
    domain: "bus",
    hasData: true,
    totalEvents: rides.length,
    totalDistanceKm: km.straight + km.measured,
    totalDurationHours: hours,
    countries: [...countries],
    countriesByYear: Object.fromEntries(
      Object.entries(countriesByYear).map(([year, set]) => [Number(year), [...set]])
    ),
    summaryByYear,
    yearlyEvents,
    dailyEvents,
    yearlyActiveDays,
    monthlyActiveDays,
    dailyActiveDays,
    weekdayEvents,
    summary: {
      headlineKpis: [
        { labelKey: "overviewCard.kpi.busRides", value: rides.length },
        ...kmKpis(km),
        { labelKey: "overviewCard.kpi.countries", value: countries.size },
      ],
      topItems: { titleKey: "overviewCard.topItems.busOperators", items: topFive(operators) },
      detailRoute: "/stats?tab=bus",
    },
  };
}
