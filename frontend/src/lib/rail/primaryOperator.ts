import { greatCircleKm } from "../../shared/flightDuration";
import { inferRailOperator } from "../../shared/railOperatorInference";
import type { RailJourney } from "../../types/rail";

type OperatorEvidence = Pick<RailJourney, "operator"> &
  Partial<
    Pick<
      RailJourney,
      | "operatorSource"
      | "trainCategory"
      | "trainNumber"
      | "depCountry"
      | "arrCountry"
      | "depStationName"
      | "arrStationName"
    >
  >;

type Leg = Pick<RailJourney, "distanceKm" | "depLat" | "depLon" | "arrLat" | "arrLon"> &
  OperatorEvidence;

/** An operator the logbook shows, and whether it was inferred rather than entered. */
export interface ShownOperator {
  name: string;
  inferred: boolean;
}

/**
 * The operator a single leg is shown under: the typed one, else — for a leg
 * written before the backfill ran — the inference table's. A stored operator
 * with `operatorSource === "inferred"` is flagged as such too.
 */
export function legOperator(leg: OperatorEvidence): ShownOperator | null {
  const typed = leg.operator?.trim();
  if (typed) return { name: typed, inferred: leg.operatorSource === "inferred" };
  const guess = inferRailOperator(leg);
  return guess ? { name: guess, inferred: true } : null;
}

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
  return primaryOperatorShown(legs)?.name ?? null;
}

/** `primaryOperator` plus whether the winning name was inferred. */
export function primaryOperatorShown(legs: readonly Leg[]): ShownOperator | null {
  const totals = new Map<string, { name: string; km: number; order: number; inferred: boolean }>();
  legs.forEach((leg, order) => {
    const shown = legOperator(leg);
    if (!shown) return;
    const { name, inferred } = shown;
    const key = name.toLocaleLowerCase();
    const km =
      leg.distanceKm !== null && Number.isFinite(leg.distanceKm)
        ? leg.distanceKm
        : greatCircleKm(leg.depLat, leg.depLon, leg.arrLat, leg.arrLon);
    const entry = totals.get(key);
    if (entry) entry.km += km;
    else totals.set(key, { name, km, order, inferred });
  });
  let best: { name: string; km: number; order: number; inferred: boolean } | null = null;
  for (const entry of totals.values()) {
    if (best === null || entry.km > best.km || (entry.km === best.km && entry.order < best.order)) {
      best = entry;
    }
  }
  return best ? { name: best.name, inferred: best.inferred } : null;
}
