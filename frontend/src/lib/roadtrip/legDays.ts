import { arrivalDay, departureDay } from "./roadtripView";
import type { RoadtripStation } from "../../types/roadtrip";
import type { TourLeg } from "../../types/tour";

/**
 * The trip day(s) each leg of a roadtrip is driven on (forgejo#424), so the
 * trip map's day filter can pick a leg instead of a whole route. A leg belongs
 * to the day its departure station was left, and — when the arrival is on
 * another day, an overnight drive — to that day too. A destination without a date
 * borrows the next dated arrival (a route correction sits between two stations); a leg nothing can
 * place gets no entry, and the map draws it in the all-days style rather than
 * calling it "another day".
 */
export function legDays(
  stations: readonly RoadtripStation[],
  legs: readonly TourLeg[]
): Map<string, string[]> {
  const left = stations.map((s) => departureDay(s) ?? arrivalDay(s));
  const reached = stations.map((s) => arrivalDay(s));
  const out = new Map<string, string[]>();
  for (const leg of legs) {
    const from = stations.findIndex((s) => s.id === leg.fromStopId);
    const to = stations.findIndex((s) => s.id === leg.toStopId);
    if (from < 0 || to < 0) continue;
    const departed = left[from];
    let arrived: string | null = null;
    for (let i = to; i < stations.length && arrived === null; i += 1) arrived = reached[i];
    const days = [...new Set([departed, arrived].filter((d): d is string => d !== null))];
    if (days.length > 0) out.set(leg.id, days);
  }
  return out;
}
