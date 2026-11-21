import { addDays, daysBetween } from "../../shared/time";
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
/** Every day from departure to arrival, so a drive over several days is on each of them. */
function driveDays(departed: string | null, arrived: string | null): string[] {
  if (departed === null || arrived === null) return [departed ?? arrived].filter((d) => d !== null);
  if (arrived <= departed) return [...new Set([departed, arrived])];
  return Array.from({ length: daysBetween(departed, arrived) + 1 }, (_, n) => addDays(departed, n));
}

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
    // A route correction has no date of its own: the drive it sits in began at the last dated stop.
    let departed = left[from];
    for (let i = from; i > 0 && departed === null && stations[i].state === "via"; i -= 1) {
      departed = left[i - 1];
    }
    let arrived: string | null = null;
    for (let i = to; i < stations.length && arrived === null; i += 1) arrived = reached[i];
    const days = driveDays(departed, arrived);
    if (days.length > 0) out.set(leg.id, days);
  }
  return out;
}
