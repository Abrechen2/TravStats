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
 * On a RIVER cruise a portless day is no sea day (`isSeaDay`, the rule the
 * rollup and the badges ask too, #359): it is a river day — named by the
 * list, so not unlisted, but neither sea nor port, and outside the type's
 * share like an unlisted day.
 *
 * ## The type
 *
 * Read on the listed days only: a sea share of at least half is a sea-heavy
 * cruise, one of a fifth or less a port-intensive one, anything between is
 * balanced. Fewer than two listed days classify nothing.
 */

import { isSeaDay } from "../../../shared/cruiseKind";
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
  /** Sea and port days — what the type is read on. */
  listedDays: number;
  /** Portless days of a river cruise: listed, but neither sea nor port. */
  riverDays: number;
  unlistedDays: number | null;
  type: CruiseType | null;
}

export function cruiseDays(row: CruiseInsightRow): CruiseDays {
  const byDay = new Map<number, { sea: boolean; port: boolean; river: boolean }>();
  for (const call of row.calls) {
    const day = byDay.get(call.dayNumber) ?? { sea: false, port: false, river: false };
    const sea = isSeaDay(row.input, call);
    byDay.set(call.dayNumber, {
      sea: day.sea || sea,
      port: day.port || (!call.isAtSea && call.portName !== null),
      river: day.river || (call.isAtSea && !sea),
    });
  }
  const days = [...byDay.values()];
  const portDays = days.filter((d) => d.port).length;
  const seaDays = days.filter((d) => !d.port && d.sea).length;
  const riverDays = days.filter((d) => !d.port && !d.sea && d.river).length;
  const listedDays = portDays + seaDays;
  const spanDays = row.startDay && row.endDay ? daysBetween(row.startDay, row.endDay) + 1 : null;
  const share = listedDays > 0 ? seaDays / listedDays : 0;
  return {
    cruiseId: row.id,
    seaDays,
    portDays,
    listedDays,
    riverDays,
    unlistedDays: spanDays === null ? null : Math.max(0, spanDays - listedDays - riverDays),
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
