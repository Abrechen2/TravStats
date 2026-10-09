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
 *
 * A snapshot in a STALE base currency is treated the same as no snapshot at
 * all — a user who moved their base currency from EUR to USD has older items
 * with `fxBaseCurrency: "EUR"` and newer ones with `"USD"`; summing their
 * `priceBase` columns would add euros to dollars, which is the exact defect
 * this module exists to fix, one level down. `backend/src/utils/lodgingStats/
 * money.ts` (`perNightPrice`) already carries this rule for stays
 * (`stay.fxBaseCurrency !== currentBaseCurrency` → treat as unpriced);
 * `shared/tripCost.ts` `tripBaseTotal` applies it to the trip-wide sum.
 *
 * WHAT each entry costs is not decided here either. This file once had its
 * own rule — bare `price`, every flight with a `bookingId` dropped — and so
 * disagreed with the travel account about the very trips it ranked
 * (forgejo#274). It now reads `shared/tripCost.ts` over `TRIP_COST_SELECT`,
 * the travel account's own inputs.
 */

import { prisma } from "../../db";
import { getBaseCurrency } from "../fx/snapshot";
import { tripBaseTotal, tripCostItems, tripSpend } from "../../shared/tripCost";
import { TRIP_COST_SELECT, toTripCostInput } from "./tripCostLoad";

export interface TripCostSuperlative {
  tripId: string;
  name: string;
  /** The money actually spent, in the trip's own dominant currency — never a
   *  converted figure. The same per-currency total `/stats/travel-account`
   *  reports for this trip. */
  amount: number;
  currency: string;
  excluded: {
    count: number;
    reason: "unconvertible";
  };
}

/**
 * The single largest per-currency total, with the old `tripDominantCost`
 * tie-break: entries are ordered EUR-first then alphabetically, and only a
 * STRICTLY larger total replaces the running winner, so a tie keeps the
 * earlier (EUR-preferring) entry. Null when no amount carries a currency.
 */
function dominantCurrencyBucket(
  spendByCurrency: Record<string, number>
): { amount: number; currency: string } | null {
  const sorted = Object.entries(spendByCurrency).sort(([a], [b]) => {
    if (a === "EUR") return -1;
    if (b === "EUR") return 1;
    return a.localeCompare(b);
  });
  if (sorted.length === 0) return null;
  let best = sorted[0];
  for (const entry of sorted) {
    if (entry[1] > best[1]) best = entry;
  }
  return { currency: best[0], amount: best[1] };
}

/** The most expensive trip across the user's ENTIRE logbook, or null when no
 *  started trip carries a recorded cost (0 included). */
export async function mostExpensiveTrip(userId: string): Promise<TripCostSuperlative | null> {
  // The base currency can change (Settings → Instance). Read it ONCE, up
  // front, and compare every snapshot's `fxBaseCurrency` against this same
  // value — never against each other — so a switch mid-history downgrades
  // the OLD snapshots to unconvertible instead of silently mixing them in.
  const currentBaseCurrency = await getBaseCurrency(userId);

  // A trip still on the drawing board hasn't spent anything yet — mirrors
  // `computeTripInsights`'s `t.status !== "planned"` filter so the two never
  // disagree about which trips are even eligible.
  const trips = await prisma.trip.findMany({
    where: { userId, status: { not: "planned" } },
    // The travel account's own cost columns (forgejo#274): this select once
    // lacked a flight's taxes and fees, so no rule could have priced them.
    select: { id: true, name: true, ...TRIP_COST_SELECT },
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
    const costs = tripCostItems(toTripCostInput(trip));
    const base = tripBaseTotal(costs.items, currentBaseCurrency);
    if (base.kind === "none") continue; // no cost on this trip — not a candidate
    if (base.kind === "unconvertible") {
      excludedCount += 1;
      continue;
    }
    if (winner === null || base.amount > winner.baseTotal) {
      // Displayed from the SAME per-currency totals the travel account
      // reports, so the tile and the account can never name two amounts.
      // Every item converted, so every non-zero one carries a currency; a
      // trip of unit-less zeros reads as 0 in the base currency.
      const bucket = dominantCurrencyBucket(tripSpend(costs).spendByCurrency) ?? {
        amount: 0,
        currency: currentBaseCurrency,
      };
      winner = { tripId: trip.id, name: trip.name, ...bucket, baseTotal: base.amount };
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
