/**
 * Sea days and port days (forgejo#257): what kind of cruise each one was, and
 * how that changed over the years. Pure.
 *
 * ## The day definition
 *
 * A day of the itinerary is one `dayNumber` of the stop list. It is a SEA DAY
 * when its stop is marked at sea, a PORT DAY when at least one stop that day
 * is a port call (matched or unresolved) — two ports on one day are one port
 * day. Days the stop list does not name (`unlistedDays`: the cruise's dates
 * span more days than the list holds) are neither and are reported, not
 * guessed; without both dates that number is unknown (null).
 *
 * ## The type
 *
 * Read on the listed days only: a sea share of at least half is a sea-heavy
 * cruise, one of a fifth or less a port-intensive one, anything between is
 * balanced. Fewer than two listed days classify nothing.
 */

import type { CruiseInsightRow } from "./rows";
import { daysBetween } from "./rows";

export const SEA_HEAVY_SHARE = 0.5; // threshold: proposal forgejo#257, owner to confirm
export const PORT_INTENSIVE_SHARE = 0.2; // threshold: proposal forgejo#257, owner to confirm
export const MIN_CLASSIFIED_DAYS = 2;

export type CruiseType = "seaHeavy" | "balanced" | "portIntensive";

export interface CruiseDays {
  cruiseId: string;
  seaDays: number;
  portDays: number;
  listedDays: number;
  unlistedDays: number | null;
  type: CruiseType | null;
}

export function cruiseDays(row: CruiseInsightRow): CruiseDays {
  const byDay = new Map<number, { sea: boolean; port: boolean }>();
  for (const call of row.calls) {
    const day = byDay.get(call.dayNumber) ?? { sea: false, port: false };
    byDay.set(call.dayNumber, {
      sea: day.sea || call.isAtSea,
      port: day.port || (!call.isAtSea && call.portName !== null),
    });
  }
  const days = [...byDay.values()];
  const portDays = days.filter((d) => d.port).length;
  const seaDays = days.filter((d) => !d.port && d.sea).length;
  const listedDays = portDays + seaDays;
  const spanDays = row.startDay && row.endDay ? daysBetween(row.startDay, row.endDay) + 1 : null;
  const share = listedDays > 0 ? seaDays / listedDays : 0;
  return {
    cruiseId: row.id,
    seaDays,
    portDays,
    listedDays,
    unlistedDays: spanDays === null ? null : Math.max(0, spanDays - listedDays),
    type:
      listedDays < MIN_CLASSIFIED_DAYS
        ? null
        : share >= SEA_HEAVY_SHARE
          ? "seaHeavy"
          : share <= PORT_INTENSIVE_SHARE
            ? "portIntensive"
            : "balanced",
  };
}
