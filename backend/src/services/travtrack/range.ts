import { toInstant } from "../../shared/time/instant";
import { fromDbDate, toDbDate } from "../../shared/time/localDate";
import { profileZoneOf } from "../../shared/time/profileZone";

/**
 * A span named the way TravTrack's routes take one (TravTrack plan T3, T6):
 * two instants, or two days — both inclusive — on the account's profile
 * clock, as instants `[from, to)`. One home, so a delete, its preview and an
 * export of the same days cover the same instants.
 */

export type NamedSpan = { from?: string; to?: string; fromDay?: string; toDay?: string };

const DAY_MS = 86_400_000;

/** Midnight starting `day` on `zone`'s clock; a midnight the zone skips is placed, not refused. */
export const midnightOf = (day: string, zone: string): Date =>
  toInstant(`${day}T00:00:00`, zone, { origin: "machine" }).utc;

/** The day after `day`, `YYYY-MM-DD`. */
export const dayAfter = (day: string): string =>
  fromDbDate(new Date(toDbDate(day).getTime() + DAY_MS));

/** How many calendar days a day span names, both ends counted. */
export const daysIn = (fromDay: string, toDay: string): number =>
  Math.round((toDbDate(toDay).getTime() - toDbDate(fromDay).getTime()) / DAY_MS) + 1;

export async function resolveSpan(
  userId: string,
  span: NamedSpan
): Promise<{ from: Date; to: Date; days: number }> {
  if (span.fromDay !== undefined && span.toDay !== undefined) {
    const { zone } = await profileZoneOf(userId);
    return {
      from: midnightOf(span.fromDay, zone),
      to: midnightOf(dayAfter(span.toDay), zone),
      days: daysIn(span.fromDay, span.toDay),
    };
  }
  const from = new Date(span.from!);
  const to = new Date(span.to!);
  return { from, to, days: (to.getTime() - from.getTime()) / DAY_MS };
}
