import type { Trip } from "../../types";
import type { TripCostSuperlative } from "../api/trips";
import { calculateDistance } from "../geo";
import { sumByCurrency, tripCostSources } from "../bookingCost";
import { formatCurrency } from "../units";

/**
 * Trip-level insights (#3): the standout trips across the whole logbook. The
 * trip is the cross-domain bracket, but until now it was only ever shown as a
 * single sum — never "which trip was the longest / most expensive / reached the
 * most countries". `longest` and `mostCountries` are still computed from the
 * (capped) trips list the caller already has, reusing the SAME cost model as
 * the cards.
 *
 * `mostExpensive` is NOT: it used to compare `tripDominantCost` — each trip's
 * largest PER-CURRENCY bucket — as a raw number across trips, so 334.000 ¥
 * beat 1.650 € and a 200.000 KRW trip (≈130 €) beat every euro trip. Fixed by
 * moving the ranking to the backend (`services/trip/tripCostSuperlative.ts`),
 * which compares the FX base-currency amount instead; the caller fetches it
 * via `tripsApi.getAllWithInsights()` and passes it in here. `tripDominantCost`
 * stays exported below — it is still correct for what it does (a trip's OWN
 * display total, never a converted figure) — but it no longer decides a
 * cross-trip ranking.
 */
export interface TripInsightWinner {
  tripId: string;
  name: string;
  /** Pre-formatted headline value, e.g. "18.420 km" or "3.360 €". */
  value: string;
  /** Raw magnitude, for the caller that wants to sort or compare. */
  amount: number;
}

export interface TripInsights {
  longest: TripInsightWinner | null;
  mostExpensive: TripInsightWinner | null;
  mostCountries: TripInsightWinner | null;
}

/** Great-circle km of a trip's flights plus its cruise legs. */
export function tripDistanceKm(trip: Trip): number {
  let km = 0;
  for (const f of trip.flights ?? []) {
    if (f.depLat != null && f.depLon != null && f.arrLat != null && f.arrLon != null) {
      km += calculateDistance(f.depLat, f.depLon, f.arrLat, f.arrLon);
    }
  }
  for (const c of trip.cruises ?? []) km += c.distanceKm ?? 0;
  return km;
}

/**
 * The single largest per-currency total of a trip, as {currency, amount}. A
 * trip mixing currencies picks its biggest bucket — the cost model never
 * converts, so a cross-currency "total" would be a fiction. null when the trip
 * has no positive cost.
 */
export function tripDominantCost(trip: Trip): { currency: string; amount: number } | null {
  const totals = sumByCurrency(
    tripCostSources(
      trip.bookings ?? [],
      trip.flights ?? [],
      trip.cruises ?? [],
      trip.lodgingStays ?? []
    )
  );
  let best: { currency: string; amount: number } | null = null;
  for (const t of totals) {
    if (best === null || t.total > best.amount) best = { currency: t.currency, amount: t.total };
  }
  return best;
}

/** Picks the trip maximising `amount`, formatting its headline via `format`. */
function winner(
  trips: Trip[],
  amount: (t: Trip) => number,
  format: (t: Trip, amount: number) => string
): TripInsightWinner | null {
  let best: TripInsightWinner | null = null;
  for (const trip of trips) {
    const a = amount(trip);
    if (a <= 0) continue;
    if (best === null || a > best.amount) {
      best = { tripId: trip.id, name: trip.name, amount: a, value: format(trip, a) };
    }
  }
  return best;
}

export function computeTripInsights(
  trips: Trip[],
  language: string,
  mostExpensiveTrip: TripCostSuperlative | null
): TripInsights {
  // A trip still on the drawing board hasn't flown, spent, or visited
  // anything yet — it must not win a superlative over a trip that has.
  const started = trips.filter((t) => t.status !== "planned");
  const nf = new Intl.NumberFormat(language);
  return {
    longest: winner(
      started,
      (t) => tripDistanceKm(t),
      (_t, km) => `${nf.format(Math.round(km))} km`
    ),
    mostExpensive: mostExpensiveTrip
      ? {
          tripId: mostExpensiveTrip.tripId,
          name: mostExpensiveTrip.name,
          amount: mostExpensiveTrip.amount,
          // Through `formatCurrency` like every other money figure (forgejo#86).
          // The amount here is the trip's OWN dominant-currency total — the
          // backend's base-currency conversion only decided WHICH trip this is.
          value: formatCurrency(mostExpensiveTrip.amount, mostExpensiveTrip.currency, {
            compact: true,
            language,
          }),
        }
      : null,
    mostCountries: winner(
      started,
      (t) => t.countries?.length ?? 0,
      (_t, n) => String(n)
    ),
  };
}
