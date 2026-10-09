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
import { loadVisibleDomainSet, type VisibleDomains } from "../domainVisibility";
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

/** What a trip cost, as the trips page shows it — the server's figure, not a client sum. */
export interface TripCostSummary {
  /** Amounts by the currency they were paid in, never summed across currencies. */
  spendByCurrency: Record<string, number>;
  /** Entries with no usable price; above 0 the spend is a lower bound. */
  unpricedEntries: number;
}

export interface TripCostInsights {
  mostExpensiveTrip: TripCostSuperlative | null;
  /** Every trip the user has, by id — uncapped, like the superlative. */
  tripCosts: Record<string, TripCostSummary>;
}

/**
 * The superlative and every trip's own cost from ONE load and ONE rule, so the
 * trips page cannot rank a trip on one figure and print another on its card.
 *
 * `visible` (`domainVisibility.loadVisibleDomainSet`) drops the rows of
 * domains the user does not see — the card and the tile may not fold in a
 * hidden domain's money. It is required, not defaulted: `/stats/travel-account`
 * passes the same set, and an ungated default is how the two once disagreed.
 */
export async function tripCostInsights(
  userId: string,
  visible: VisibleDomains
): Promise<TripCostInsights> {
  // The base currency can change (Settings → Instance). Read it ONCE, up
  // front, and compare every snapshot's `fxBaseCurrency` against this same
  // value — never against each other — so a switch mid-history downgrades
  // the OLD snapshots to unconvertible instead of silently mixing them in.
  const [currentBaseCurrency, trips] = await Promise.all([
    getBaseCurrency(userId),
    prisma.trip.findMany({
      where: { userId },
      // The travel account's own cost columns (forgejo#274): this select once
      // lacked a flight's taxes and fees, so no rule could have priced them.
      select: { id: true, name: true, status: true, ...TRIP_COST_SELECT },
    }),
  ]);

  const tripCosts: Record<string, TripCostSummary> = {};
  let winner: {
    tripId: string;
    name: string;
    amount: number;
    currency: string;
    baseTotal: number;
  } | null = null;
  let excludedCount = 0;

  for (const trip of trips) {
    const costs = tripCostItems(toTripCostInput(trip, visible));
    const { spendByCurrency, unpricedEntries } = tripSpend(costs);
    tripCosts[trip.id] = { spendByCurrency, unpricedEntries };

    // A trip still on the drawing board hasn't spent anything yet — mirrors
    // `computeTripInsights`'s `t.status !== "planned"` filter so the two never
    // disagree about which trips are even eligible.
    if (trip.status === "planned") continue;
    const base = tripBaseTotal(costs.items, currentBaseCurrency);
    if (base.kind === "none") continue; // no cost on this trip — not a candidate
    if (base.kind === "unconvertible") {
      excludedCount += 1;
      continue;
    }
    if (winner === null || base.amount > winner.baseTotal) {
      // Displayed from the SAME per-currency totals the card and the travel
      // account report, so no two surfaces name two amounts for one trip.
      // Every item converted, so every non-zero one carries a currency; a
      // trip of unit-less zeros reads as 0 in the base currency.
      const bucket = dominantCurrencyBucket(spendByCurrency) ?? {
        amount: 0,
        currency: currentBaseCurrency,
      };
      winner = { tripId: trip.id, name: trip.name, ...bucket, baseTotal: base.amount };
    }
  }

  return {
    mostExpensiveTrip:
      winner === null
        ? null
        : {
            tripId: winner.tripId,
            name: winner.name,
            amount: winner.amount,
            currency: winner.currency,
            excluded: { count: excludedCount, reason: "unconvertible" },
          },
    tripCosts,
  };
}

/** The most expensive trip across the user's ENTIRE logbook, or null when no
 *  started trip carries a recorded cost (0 included). */
export async function mostExpensiveTrip(
  userId: string,
  visible: VisibleDomains
): Promise<TripCostSuperlative | null> {
  return (await tripCostInsights(userId, visible)).mostExpensiveTrip;
}

/** One trip's cost, for its own page — the same rule and gate as the list. */
export async function tripCostSummary(
  userId: string,
  tripId: string,
  visible: VisibleDomains
): Promise<TripCostSummary | null> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    select: TRIP_COST_SELECT,
  });
  if (trip === null) return null;
  const { spendByCurrency, unpricedEntries } = tripSpend(
    tripCostItems(toTripCostInput(trip, visible))
  );
  return { spendByCurrency, unpricedEntries };
}

/** `tripCostInsights` behind the user's own domain gate — what the trips page is served. */
export async function tripsPageCosts(userId: string): Promise<TripCostInsights> {
  return tripCostInsights(userId, await loadVisibleDomainSet(userId));
}

/** `tripCostSummary` behind the user's own domain gate — what a trip's page is served. */
export async function tripPageCost(
  userId: string,
  tripId: string
): Promise<TripCostSummary | null> {
  return tripCostSummary(userId, tripId, await loadVisibleDomainSet(userId));
}
