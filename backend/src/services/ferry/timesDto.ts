/** Ferry crossings (dennis/TravStats forgejo#293). */
import type { FerryTimes } from "../../schemas/times";
import { railTimes, type RailTimeColumns } from "../rail/timesDto";

/**
 * Every ferry response goes through here, so this is also where the
 * `roadtripLegBefore` snapshot is dropped: it is the linked leg's routing kept
 * only so unlinking can give it back, and it went out on every crossing (with
 * waypoints of a road leg) once the column existed.
 */
export function withFerryTimes<T extends RailTimeColumns & { roadtripLegBefore?: unknown }>(
  ride: T
): Omit<T, "roadtripLegBefore"> & { times: FerryTimes } {
  const { roadtripLegBefore: _linkSnapshot, ...shown } = ride;
  return { ...shown, times: railTimes(ride) };
}
