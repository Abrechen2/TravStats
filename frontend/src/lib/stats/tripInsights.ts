import type { Trip } from "../../types";
import { calculateDistance } from "../geo";
import { sumByCurrency, tripCostSources } from "../bookingCost";

/**
 * Trip-level insights (#3): the standout trips across the whole logbook. The
 * trip is the cross-domain bracket, but until now it was only ever shown as a
 * single sum — never "which trip was the longest / most expensive / reached the
 * most countries". Computed from the trips list, reusing the SAME cost model as
 * the cards so a trip's cost can never disagree between screens.
 */
export interface TripInsightWinner {
  tripId: string;
  name: string;
  /** Pre-formatted headline value, e.g. "18.420 km" or "EUR 3360". */
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
    tripCostSources(trip.bookings ?? [], trip.flights ?? [], trip.cruises ?? [], trip.lodgingStays ?? [])
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

export function computeTripInsights(trips: Trip[], language: string): TripInsights {
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
    mostExpensive: winner(
      started,
      (t) => tripDominantCost(t)?.amount ?? 0,
      (t) => {
        const c = tripDominantCost(t)!;
        return `${c.currency} ${nf.format(Math.round(c.amount))}`;
      }
    ),
    mostCountries: winner(
      started,
      (t) => t.countries?.length ?? 0,
      (_t, n) => String(n)
    ),
  };
}
