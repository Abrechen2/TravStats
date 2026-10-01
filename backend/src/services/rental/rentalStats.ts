import { prisma } from "../../db";
import {
  countableRentalWhere,
  rentalCost,
  rentalCountries,
  rentalDays,
  rentalYear,
} from "../../shared/rentalCounting";
import { isOneWay } from "./rentalWrite";

/**
 * The rental statistics (spec 2026-10-01-rental-domain-design §7.4; concept
 * page 2026-10-01): rentals and rental days per year on the stations'
 * calendars, providers ranked by rental days with brokers apart (D4 c),
 * station countries only (D8 a), cost per rental day per currency, and km
 * that say how many rentals they cover. Only `completed` rentals count; a
 * missing price or km stays out of its figure, never a zero inside it.
 */

export interface RentalStats {
  rentals: number;
  days: number;
  oneWay: number;
  byYear: Array<{ year: number; rentals: number; days: number }>;
  providers: Array<{ provider: string; rentals: number; days: number }>;
  brokers: Array<{ broker: string; rentals: number }>;
  countries: string[];
  /** Per currency of the counted cost: the amount per rental day and how many rentals carry one. */
  costPerDay: Array<{ currency: string; perDay: number; rentals: number; days: number }>;
  /** Km only where an invoice (or a labelled correction) gave them. Null total when none did. */
  km: { total: number | null; covered: number; of: number };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

type Row = {
  pickupTime: Date;
  pickupTimezone: string;
  returnTime: Date;
  returnTimezone: string;
  pickupCountry: string | null;
  returnCountry: string | null;
  pickupAirportId: number | null;
  returnAirportId: number | null;
  pickupLat: number;
  pickupLon: number;
  returnLat: number;
  returnLon: number;
  provider: string;
  broker: string | null;
  price: number | null;
  currency: string | null;
  finalAmount: number | null;
  finalCurrency: string | null;
  distanceKm: number | null;
};

/** Pure: the figures of a set of countable rentals. */
export function computeRentalStats(rows: readonly Row[], year: number | null): RentalStats {
  const inScope = year === null ? rows : rows.filter((r) => rentalYear(r) === year);
  const days = inScope.map((r) => rentalDays(r));
  const totalDays = days.reduce((a, b) => a + b, 0);

  const years = new Map<number, { rentals: number; days: number }>();
  rows.forEach((r) => {
    const y = rentalYear(r);
    const cur = years.get(y) ?? { rentals: 0, days: 0 };
    years.set(y, { rentals: cur.rentals + 1, days: cur.days + rentalDays(r) });
  });

  const providers = new Map<string, { rentals: number; days: number }>();
  const brokers = new Map<string, number>();
  const cost = new Map<string, { amount: number; rentals: number; days: number }>();
  const countries = new Set<string>();
  let kmTotal = 0;
  let kmCovered = 0;
  inScope.forEach((r, i) => {
    const p = providers.get(r.provider) ?? { rentals: 0, days: 0 };
    providers.set(r.provider, { rentals: p.rentals + 1, days: p.days + days[i] });
    if (r.broker) brokers.set(r.broker, (brokers.get(r.broker) ?? 0) + 1);
    rentalCountries(r).forEach((c) => countries.add(c));
    const paid = rentalCost(r);
    if (paid) {
      const c = cost.get(paid.currency) ?? { amount: 0, rentals: 0, days: 0 };
      cost.set(paid.currency, {
        amount: c.amount + paid.amount,
        rentals: c.rentals + 1,
        days: c.days + days[i],
      });
    }
    if (r.distanceKm !== null) {
      kmTotal += r.distanceKm;
      kmCovered += 1;
    }
  });

  return {
    rentals: inScope.length,
    days: totalDays,
    oneWay: inScope.filter((r) => isOneWay(r)).length,
    byYear: [...years.entries()].sort(([a], [b]) => a - b).map(([y, v]) => ({ year: y, ...v })),
    providers: [...providers.entries()]
      .map(([provider, v]) => ({ provider, ...v }))
      .sort(
        (a, b) => b.days - a.days || b.rentals - a.rentals || a.provider.localeCompare(b.provider)
      ),
    brokers: [...brokers.entries()]
      .map(([broker, rentals]) => ({ broker, rentals }))
      .sort((a, b) => b.rentals - a.rentals || a.broker.localeCompare(b.broker)),
    countries: [...countries].sort(),
    costPerDay: [...cost.entries()]
      .map(([currency, v]) => ({
        currency,
        perDay: round2(v.amount / v.days),
        rentals: v.rentals,
        days: v.days,
      }))
      .sort((a, b) => b.rentals - a.rentals || a.currency.localeCompare(b.currency)),
    km: { total: kmCovered > 0 ? kmTotal : null, covered: kmCovered, of: inScope.length },
  };
}

export async function rentalStatsFor(userId: string, year: number | null): Promise<RentalStats> {
  const rows = await prisma.rentalBooking.findMany({
    where: { userId, ...countableRentalWhere() },
    select: {
      pickupTime: true,
      pickupTimezone: true,
      returnTime: true,
      returnTimezone: true,
      pickupCountry: true,
      returnCountry: true,
      pickupAirportId: true,
      returnAirportId: true,
      pickupLat: true,
      pickupLon: true,
      returnLat: true,
      returnLon: true,
      provider: true,
      broker: true,
      price: true,
      currency: true,
      finalAmount: true,
      finalCurrency: true,
      distanceKm: true,
    },
  });
  return computeRentalStats(rows, year);
}
