/**
 * Whether a cruise leg runs inland — the one rule both the distance chain
 * (`seaRouteCalculator.accepts`) and the map line (`cruiseGeometry.ts`) ask
 * before handing a leg to the sea router.
 *
 * The sea router walks a land/water mask. A Nile port is "land" on that mask,
 * so the router snaps it to the nearest open sea and back: on prod a Nile
 * cruise drew every leg Luxor -> Safaga (Red Sea) -> Edfu across the desert,
 * while its stored distance was the chord (2026-10-16). Two answers to one
 * question is how the map and the kilometres drifted apart, so the question
 * lives here once.
 */

import { isRiverCruise } from "../../shared/cruiseKind";

/** The region taxonomy of a river port: `river_<name>` (see data/rivers/). */
const RIVER_REGION_PREFIX = "river_";

export function isRiverPort(port: { region?: string | null }): boolean {
  return port.region?.startsWith(RIVER_REGION_PREFIX) === true;
}

/**
 * A leg is inland when the cruise is a river cruise (its catalogue-less ports
 * may carry no region at all), or when either end is a river port — a river
 * port is off the sea mask whatever the other end is.
 */
export function isInlandLeg(
  from: { region?: string | null },
  to: { region?: string | null },
  cruiseKind: string | null | undefined
): boolean {
  return isRiverCruise({ kind: cruiseKind }) || isRiverPort(from) || isRiverPort(to);
}
