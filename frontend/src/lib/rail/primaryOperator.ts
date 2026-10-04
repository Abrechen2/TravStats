import { greatCircleKm } from "../../shared/flightDuration";
import type { RailJourney } from "../../types/rail";

type Leg = Pick<RailJourney, "operator" | "distanceKm" | "depLat" | "depLon" | "arrLat" | "arrLon">;

/**
 * The operator a ride is shown under in the logbook (forgejo#197): the one
 * that carried the reader the FURTHEST. A ride from Köln to Paris with a
 * regional train to Aachen and a Thalys onwards is a Thalys ride, not a ride
 * of whoever ran the first leg.
 *
 * - Distance per operator is summed over its legs, so two short DB legs can
 *   outweigh one longer leg of another operator.
 * - A leg's distance is its recorded figure when there is one, else the
 *   straight line between its stations. This picks a name; it states no
 *   distance, so a mix of measured and straight-line figures is harmless here
 *   in a way it would not be in a total.
 * - Operators are matched as written but ignoring case and surrounding space;
 *   the name returned is the first leg's spelling.
 * - On a tie the operator met first in travel order wins — a stable answer.
 * - Legs without an operator count for nobody. Null when no leg names one:
 *   an operator nobody recorded is not invented.
 */
export function primaryOperator(legs: readonly Leg[]): string | null {
  const totals = new Map<string, { name: string; km: number; order: number }>();
  legs.forEach((leg, order) => {
    const name = leg.operator?.trim();
    if (!name) return;
    const key = name.toLocaleLowerCase();
    const km =
      leg.distanceKm !== null && Number.isFinite(leg.distanceKm)
        ? leg.distanceKm
        : greatCircleKm(leg.depLat, leg.depLon, leg.arrLat, leg.arrLon);
    const entry = totals.get(key);
    if (entry) entry.km += km;
    else totals.set(key, { name, km, order });
  });
  let best: { name: string; km: number; order: number } | null = null;
  for (const entry of totals.values()) {
    if (best === null || entry.km > best.km || (entry.km === best.km && entry.order < best.order)) {
      best = entry;
    }
  }
  return best?.name ?? null;
}
