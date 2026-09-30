import { dayOf, type TimeValue } from "../shared/time";

/**
 * Calendar-day difference between arrival and departure, each on its own
 * airport's calendar — the days in the two values' `local` (ADR 0002). 0 =
 * same local day, 1 = "+1" overnight, negative when crossing the date line
 * westbound. No zone is looked up here: the server already read each end on
 * its airport's clock.
 */
export function dayShift(departure: TimeValue, arrival: TimeValue): number {
  const dep = Date.parse(`${dayOf(departure)}T00:00:00Z`);
  const arr = Date.parse(`${dayOf(arrival)}T00:00:00Z`);
  return Math.round((arr - dep) / 86_400_000);
}
