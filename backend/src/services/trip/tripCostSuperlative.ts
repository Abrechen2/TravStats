/**
 * The most expensive trip, ranked honestly across currencies (#3 / evidence
 * spec "The most expensive trip").
 *
 * `frontend/src/lib/stats/tripInsights.ts` used to pick each trip's largest
 * PER-CURRENCY bucket (`tripDominantCost`) and then compare those raw numbers
 * across trips: 334.000 ¥ beat 1.650 €, and a 200.000 KRW trip (≈130 €) beat
 * every euro trip on the page — the currencies were never converted, only
 * their face values were. This module ranks on the FX base-currency amount
 * instead (`priceBase`/`totalPriceBase`, the snapshot every priced model now
 * carries — Cruise was the last to gain it, see the `cruise_base_currency`
 * migration).
 *
 * The ranking still needs the trip's own currency for DISPLAY: the number
 * shown to the user is what was actually spent, in the currency it was spent
 * in — the conversion decides the ORDER, never the label. So this returns
 * both: `amount`/`currency` are the dominant-currency bucket exactly like the
 * old frontend logic (kept for display), while the WINNER is chosen by the
 * summed base-currency total across every cost source on the trip.
 *
 * Computed over EVERY trip the user has, not the capped `GET /trips` payload
 * (500 trips, 200 nested rows per domain) — a trip beyond that cap could
 * never win there, which is its own kind of wrong answer.
 *
 * A trip that carries any cost item priced but not convertible to the base
 * currency (no FX snapshot — missing currency, missing date, or a failed
 * lookup) leaves the comparison entirely rather than being ranked on a partial
 * sum. `excluded.count` says how many trips that happened to, so a caller
 * can say why the "winner" might not be the true maximum.
 */

import { prisma } from "../../db";

export interface TripCostSuperlative {
  tripId: string;
  name: string;
  /** The money actually spent, in the trip's own dominant currency — never a
   *  converted figure. */
  amount: number;
  currency: string;
  excluded: {
    count: number;
    reason: "unconvertible";
  };
}

interface CostItem {
  /** Raw amount, in `currency` — never converted. */
  price: number;
  currency: string;
  /** The same amount converted to the user's base currency, or null when no
   *  honest conversion exists. */
  priceBase: number | null;
}

/** A null or zero price counts as "no price" — mirrors `bookingCost.sumByCurrency`. */
function pushIfPriced(
  items: CostItem[],
  price: number | null,
  currency: string | null,
  priceBase: number | null
): void {
  if (price == null || price <= 0) return;
  // No currency on the schema's default column is EUR; matches sumByCurrency.
  items.push({ price, currency: currency ?? "EUR", priceBase });
}

/**
 * The single largest per-currency total, exactly like
 * `bookingCost.sumByCurrency` + the old `tripDominantCost` tie-break: entries
 * are ordered EUR-first then alphabetically, and only a STRICTLY larger total
 * replaces the running winner, so a tie keeps the earlier (EUR-preferring)
 * entry.
 */
function dominantCurrencyBucket(items: CostItem[]): { amount: number; currency: string } {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.price);
  }
  const sorted = [...totals.entries()].sort(([a], [b]) => {
    if (a === "EUR") return -1;
    if (b === "EUR") return 1;
    return a.localeCompare(b);
  });
  let best = sorted[0];
  for (const entry of sorted) {
    if (entry[1] > best[1]) best = entry;
  }
  return { currency: best[0], amount: best[1] };
}

/**
 * The trip's cost sources, matching `frontend/src/lib/bookingCost.tripCostSources`:
 * every booking, plus any flight/cruise/stay that carries its own price
 * (no `bookingId` — an item linked to a booking has had its price moved
 * there on import, so counting both would double it).
 */
function costItemsForTrip(trip: {
  bookings: { price: number | null; currency: string | null; priceBase: number | null }[];
  flights: {
    price: number | null;
    currency: string | null;
    priceBase: number | null;
    bookingId: string | null;
  }[];
  cruises: {
    price: number | null;
    currency: string | null;
    priceBase: number | null;
    bookingId: string | null;
  }[];
  lodgingStays: {
    totalPrice: number | null;
    currency: string | null;
    totalPriceBase: number | null;
    bookingId: string | null;
  }[];
}): CostItem[] {
  const items: CostItem[] = [];
  for (const b of trip.bookings) pushIfPriced(items, b.price, b.currency, b.priceBase);
  for (const f of trip.flights) {
    if (!f.bookingId) pushIfPriced(items, f.price, f.currency, f.priceBase);
  }
  for (const c of trip.cruises) {
    if (!c.bookingId) pushIfPriced(items, c.price, c.currency, c.priceBase);
  }
  for (const s of trip.lodgingStays) {
    if (!s.bookingId) pushIfPriced(items, s.totalPrice, s.currency, s.totalPriceBase);
  }
  return items;
}

/** The most expensive trip across the user's ENTIRE logbook, or null when no
 *  started trip carries a positive cost. */
export async function mostExpensiveTrip(userId: string): Promise<TripCostSuperlative | null> {
  // A trip still on the drawing board hasn't spent anything yet — mirrors
  // `computeTripInsights`'s `t.status !== "planned"` filter so the two never
  // disagree about which trips are even eligible.
  const trips = await prisma.trip.findMany({
    where: { userId, status: { not: "planned" } },
    select: {
      id: true,
      name: true,
      bookings: { select: { price: true, currency: true, priceBase: true } },
      flights: { select: { price: true, currency: true, priceBase: true, bookingId: true } },
      cruises: { select: { price: true, currency: true, priceBase: true, bookingId: true } },
      lodgingStays: {
        select: { totalPrice: true, currency: true, totalPriceBase: true, bookingId: true },
      },
    },
  });

  let winner: {
    tripId: string;
    name: string;
    amount: number;
    currency: string;
    baseTotal: number;
  } | null = null;
  let excludedCount = 0;

  for (const trip of trips) {
    const items = costItemsForTrip(trip);
    if (items.length === 0) continue; // no cost on this trip — not a candidate

    const unconvertible = items.some((i) => i.priceBase == null);
    if (unconvertible) {
      excludedCount += 1;
      continue;
    }

    const baseTotal = items.reduce((sum, i) => sum + (i.priceBase as number), 0);
    if (winner === null || baseTotal > winner.baseTotal) {
      const { amount, currency } = dominantCurrencyBucket(items);
      winner = { tripId: trip.id, name: trip.name, amount, currency, baseTotal };
    }
  }

  if (winner === null) return null;
  return {
    tripId: winner.tripId,
    name: winner.name,
    amount: winner.amount,
    currency: winner.currency,
    excluded: { count: excludedCount, reason: "unconvertible" },
  };
}
