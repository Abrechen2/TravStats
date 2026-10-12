/** Ferry crossings (dennis/TravStats forgejo#293). */
import type { RailTimes } from "../../schemas/times";
import { railTimes, type RailTimeColumns } from "../rail/timesDto";

export function withFerryTimes<T extends RailTimeColumns>(ride: T): T & { times: RailTimes } {
  return { ...ride, times: railTimes(ride) };
}
