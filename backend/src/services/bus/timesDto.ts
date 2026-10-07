import type { BusTimes } from "../../schemas/times";
import { railTimes, type RailTimeColumns } from "../rail/timesDto";

/**
 * A bus ride's `times` (ADR 0002): rail's reader under the bus name, because
 * the two ends carry rail's columns. `BusTimes` and `RailTimes` are the same
 * shape, registered twice so each domain's OpenAPI names its own.
 */
export function withBusTimes<T extends RailTimeColumns>(ride: T): T & { times: BusTimes } {
  return { ...ride, times: railTimes(ride) };
}
