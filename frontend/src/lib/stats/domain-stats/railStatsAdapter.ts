// Adapter: RailJourney[] -> DomainStats. Pure, sync.
//
// The rail counterpart of adaptCruise (spec 2026-09-25-rail-domain, phase 2b).
// Every "does it count, and when" question goes through `shared/railCounting`
// — the same module the server's `crossDomainPopulations` asks — so the
// overview card and the evidence panel behind it cannot disagree about which
// rides happened, or on which day.
//
// Distance is split by what it measures (owner decision 7): the straight line
// between the stations understates the track by 10-30 %, so it is never added
// silently to a traced or ticket figure under one "distance" label.
import type { RailJourney } from "../../../types/rail";
import {
  isCountableRail,
  railCountries,
  railDayKeys,
  railYear,
} from "../../../shared/railCounting";
import type { DomainKpi, DomainStats, YearSummary } from "./types";
import { bucket, topFive } from "./yearSummary";

export interface RailAdapterInput {
  journeys: RailJourney[];
}

type RailRide = Pick<
  RailJourney,
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

function addKm(km: Km, ride: RailRide): void {
  if (ride.distanceKm === null) return;
  if (ride.distanceSource === "great_circle") km.straight += ride.distanceKm;
  else km.measured += ride.distanceKm;
}

/**
 * The distance KPIs, one per kind that exists. A user with only straight-line
 * rides sees "km (straight line)" and nothing pretending to be the track.
 */
function kmKpis(km: Km): DomainKpi[] {
  return [
    ...(km.measured > 0
      ? [
          {
            labelKey: "overviewCard.kpi.railKmMeasured",
            value: Math.round(km.measured),
            unit: "km" as const,
          },
        ]
      : []),
    ...(km.straight > 0
      ? [
          {
            labelKey: "overviewCard.kpi.railKmStraight",
            value: Math.round(km.straight),
            unit: "km" as const,
          },
        ]
      : []),
  ];
}

export function adaptRail(input: RailAdapterInput): DomainStats {
  const rides: RailRide[] = input.journeys.filter((j) => isCountableRail(j));
  if (rides.length === 0) return { domain: "rail", hasData: false };

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
    const year = railYear(ride);
    const days = railDayKeys(ride);
    const departureDay = days[0];
    const rideCountries = railCountries(ride);

    yearlyEvents[year] = (yearlyEvents[year] ?? 0) + 1;
    // Keyed on the departure day, as the year is: one ride, one event, on the
    // day it left — on its station's calendar, not the reader's.
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
        { labelKey: "overviewCard.kpi.railJourneys", value: y.rides },
        ...kmKpis(y.km),
        { labelKey: "overviewCard.kpi.countries", value: countriesByYear[year]?.size ?? 0 },
      ],
      topItems: { titleKey: "overviewCard.topItems.railOperators", items: topFive(y.operators) },
    };
  }

  return {
    domain: "rail",
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
        { labelKey: "overviewCard.kpi.railJourneys", value: rides.length },
        ...kmKpis(km),
        { labelKey: "overviewCard.kpi.countries", value: countries.size },
      ],
      topItems: { titleKey: "overviewCard.topItems.railOperators", items: topFive(operators) },
      detailRoute: "/stats?tab=rail",
    },
  };
}
