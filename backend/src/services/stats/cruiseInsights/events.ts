/**
 * The special events of a cruise (forgejo#257) — the ones the badges already
 * detect (the equator, the date line, a birthday or New Year's Eve aboard, a
 * canal transit, polar waters) — attributed cruise by cruise so the statistics
 * can name WHICH voyage proved each.
 *
 * Not a second detector: each cruise is run through the badges' own
 * calculator (`utils/cruiseStats.ts` `calculateCruiseStats`) on its own, so
 * the event listed here and the badge it unlocks are one rule. That
 * calculator reads the legs between consecutive catalogue ports and the
 * cruise's dates; an unresolved port has no position and proves no crossing.
 */

import { calculateCruiseStats } from "../../../utils/cruiseStats";
import type { CruiseInsightRow } from "./rows";

export const CRUISE_EVENTS = [
  "equator",
  "dateline",
  "birthdayAtSea",
  "newYearAtSea",
  "canal",
  "polar",
] as const;
export type CruiseEvent = (typeof CRUISE_EVENTS)[number];

export function eventsOfCruise(
  row: CruiseInsightRow,
  birthday: { month: number; day: number } | undefined
): CruiseEvent[] {
  const s = calculateCruiseStats([row.input], birthday);
  const flags: Record<CruiseEvent, boolean> = {
    equator: s.hasEquatorCrossing,
    dateline: s.hasDatelineCrossing,
    birthdayAtSea: s.hasBirthdayAtSea,
    newYearAtSea: s.hasNewYearsAtSea,
    canal: s.hasCanalTransit,
    polar: s.hasPolar,
  };
  return CRUISE_EVENTS.filter((event) => flags[event]);
}
