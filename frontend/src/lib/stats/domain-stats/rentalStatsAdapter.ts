// Adapter: RentalBooking[] -> DomainStats. Pure, sync.
//
// A returned rental is one experience on the overview, filed under the year it
// was picked up on its station's calendar — the rule of `shared/rentalCounting`,
// which the server's `crossDomainPopulations.loadRental` asks too, so the card
// and the evidence panel cannot disagree.
//
// What it does NOT hand over is the point (rental spec §11 D3 a, owner
// 2026-10-01): no active day and no country. Rental days are a rental
// statistic only — the days travelling come from the trip, the countries from
// the trip's own entries — so the day indexes stay empty and the overview's
// unions never see a rental. The rental days themselves appear on the card, as
// the rental tab counts them.
import type { RentalBooking } from "../../../types/rental";
import {
  isCountableRental,
  rentalDays,
  rentalDrivenKm,
  rentalYear,
} from "../../../shared/rentalCounting";
import { localDay } from "../../../shared/time";
import type { DomainKpi, DomainStats, YearSummary } from "./types";
import { bucket, topFive } from "./yearSummary";

export interface RentalAdapterInput {
  rentals: RentalBooking[];
}

interface Tally {
  rentals: number;
  days: number;
  /** Null until one rental knows its km — unknown is never 0. */
  km: number | null;
  providers: Map<string, number>;
}

const emptyTally = (): Tally => ({ rentals: 0, days: 0, km: null, providers: new Map() });

function kpis(tally: Tally): DomainKpi[] {
  return [
    { labelKey: "overviewCard.kpi.rentals", value: tally.rentals },
    { labelKey: "overviewCard.kpi.rentalDays", value: tally.days },
    ...(tally.km !== null
      ? [
          {
            labelKey: "overviewCard.kpi.rentalKm",
            value: Math.round(tally.km),
            unit: "km" as const,
          },
        ]
      : []),
  ];
}

function add(tally: Tally, rental: RentalBooking, days: number | null): void {
  tally.rentals += 1;
  if (days !== null) tally.days += days;
  const driven = rentalDrivenKm(rental);
  if (driven) tally.km = (tally.km ?? 0) + driven.km;
  const provider = rental.provider.trim();
  if (provider) tally.providers.set(provider, (tally.providers.get(provider) ?? 0) + 1);
}

export function adaptRental(input: RentalAdapterInput): DomainStats {
  const rentals = input.rentals.filter((r) => isCountableRental(r));
  if (rentals.length === 0) return { domain: "rental", hasData: false };

  const lifetime = emptyTally();
  const perYear = new Map<number, Tally>();
  const yearlyEvents: Record<number, number> = {};
  const dailyEvents: Record<string, number> = {};
  const weekdayEvents: Record<number, number> = {};

  for (const rental of rentals) {
    const pickup = rental.times.pickup?.utc ?? null;
    const ret = rental.times.return?.utc ?? null;
    const days =
      pickup && ret
        ? rentalDays({
            pickupTime: pickup,
            returnTime: ret,
            pickupTimezone: rental.pickupTimezone,
            returnTimezone: rental.returnTimezone,
          })
        : null;
    add(lifetime, rental, days);
    // A rental with no pick-up instant belongs to no year: it counts in the
    // lifetime total and in no bucket, as an undated entry does everywhere.
    if (!pickup) continue;
    const year = rentalYear({ pickupTime: pickup, pickupTimezone: rental.pickupTimezone });
    const pickupDay = localDay(pickup, rental.pickupTimezone);
    yearlyEvents[year] = (yearlyEvents[year] ?? 0) + 1;
    dailyEvents[pickupDay] = (dailyEvents[pickupDay] ?? 0) + 1;
    const weekday = new Date(`${pickupDay}T00:00:00Z`).getUTCDay();
    weekdayEvents[weekday] = (weekdayEvents[weekday] ?? 0) + 1;
    add(bucket(perYear, year, emptyTally), rental, days);
  }

  const summaryByYear: Record<number, YearSummary> = {};
  for (const [year, tally] of perYear) {
    summaryByYear[year] = {
      headlineKpis: kpis(tally),
      topItems: {
        titleKey: "overviewCard.topItems.rentalProviders",
        items: topFive(tally.providers),
      },
    };
  }

  return {
    domain: "rental",
    hasData: true,
    totalEvents: rentals.length,
    // No country: a rental proves none on the overview (D3 a).
    countries: [],
    countriesByYear: {},
    summaryByYear,
    yearlyEvents,
    dailyEvents,
    // No travel day either (D3 a) — empty indexes, not absent ones, so the
    // fold reads "this domain names its days, and there are none".
    yearlyActiveDays: {},
    monthlyActiveDays: {},
    dailyActiveDays: {},
    weekdayEvents,
    summary: {
      headlineKpis: kpis(lifetime),
      topItems: {
        titleKey: "overviewCard.topItems.rentalProviders",
        items: topFive(lifetime.providers),
      },
      detailRoute: "/stats?tab=rental",
    },
  };
}
