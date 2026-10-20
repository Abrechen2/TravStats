import type { ItineraryItem, ItineraryView } from "../../schemas/shareLinkItinerary";
import { SHARE_LINK_ITINERARY_GRACE_MS } from "../../schemas/shareLinks";
import { startOfDayAt } from "../../shared/time/legacyValues";
import { fromDbDate, toDbDate } from "../../shared/time/localDate";
import type { LocalDateValue, TimeValue } from "../../shared/time/wire";
import { isValidZone } from "../../shared/time/zonedParts";

/**
 * Where on the plan the traveller is (forgejo#302): the span each itinerary
 * entry covers in real instants, the order they are listed in, and the entry
 * in progress — or the next one — at a given instant.
 *
 * Everything here works on instants (`utc`) and on a day's bounds AT ITS
 * PLACE, never on the host's zone. A value that knows only its day covers
 * that whole local day; a value that knows only its month or year covers no
 * span at all — the plan says nothing about where in that month it was, and
 * guessing a midnight would mark an entry "now" that may not be.
 */

export interface Span {
  start: number;
  end: number;
}

const DAY_MS = 86_400_000;

const nextDay = (day: string): string => fromDbDate(new Date(toDbDate(day).getTime() + DAY_MS));

/**
 * A local day's bounds at its place. A day with no zone (a span the user typed
 * without a place) is read in UTC — the approximation is ours to show "now",
 * never a time anyone sees.
 */
function daySpan(day: string, zone: string | null): Span {
  const at = zone && isValidZone(zone) ? zone : "UTC";
  return { start: startOfDayAt(day, at).getTime(), end: startOfDayAt(nextDay(day), at).getTime() };
}

/** The span a time value covers: an instant to the minute, its local day for day/unknown. */
export function spanOfTime(value: TimeValue | null): Span | null {
  if (!value) return null;
  if (value.precision === "minute") {
    const t = Date.parse(value.utc);
    return { start: t, end: t };
  }
  if (value.precision === "day" || value.precision === "unknown") {
    return daySpan(value.local.slice(0, 10), value.zone);
  }
  return null;
}

export function spanOfDay(value: LocalDateValue | null): Span | null {
  return value && value.precision === "day" ? daySpan(value.date, value.zone) : null;
}

/** From the start of the first span to the end of the last; either side may be missing. */
function between(from: Span | null, to: Span | null): Span | null {
  if (!from) return null;
  if (!to || to.end < from.start) return from;
  return { start: from.start, end: to.end };
}

/** The span an entry covers, or null when its plan names no day. */
export function spanOfItem(item: ItineraryItem): Span | null {
  switch (item.kind) {
    case "flight":
    case "rail":
    case "bus":
    case "ferry":
      return between(spanOfTime(item.departure), spanOfTime(item.arrival));
    case "stay":
      return between(
        spanOfTime(item.checkInAt) ?? spanOfDay(item.checkIn),
        spanOfTime(item.checkOutAt) ?? spanOfDay(item.checkOut)
      );
    case "cruise":
      return between(spanOfDay(item.start), spanOfDay(item.end));
    case "rental":
      return between(spanOfTime(item.pickup.at), spanOfTime(item.return.at));
    case "visit":
      return spanOfTime(item.at);
    case "stop":
      return between(spanOfTime(item.start), spanOfTime(item.end));
  }
}

/**
 * Entries in plan order: by the instant they begin; an entry whose plan names
 * no day goes last, in the order it was loaded (a stable sort).
 */
export function sortItinerary(items: ItineraryItem[]): ItineraryItem[] {
  const keyed = items.map((item) => ({ item, start: spanOfItem(item)?.start ?? Infinity }));
  return keyed.sort((a, b) => a.start - b.start).map((k) => k.item);
}

/**
 * The entry in progress at `at`, else the next one to begin. Of several in
 * progress, the one that began last wins: a flight taken during a hotel stay
 * is where the traveller is while it is in the air.
 */
export function nowMarker(items: readonly ItineraryItem[], at: Date): ItineraryView["now"] {
  const t = at.getTime();
  let current: { index: number; start: number } | null = null;
  let next: { index: number; start: number } | null = null;
  for (let index = 0; index < items.length; index++) {
    const span = spanOfItem(items[index]);
    if (!span) continue;
    if (span.start <= t && t < span.end) {
      if (!current || span.start >= current.start) current = { index, start: span.start };
    } else if (span.start > t && (!next || span.start < next.start)) {
      next = { index, start: span.start };
    }
  }
  if (current) return { index: current.index, state: "inProgress" };
  return next ? { index: next.index, state: "next" } : null;
}

/**
 * When an itinerary link stops working by itself: 24 hours after the end of
 * the trip's last local day. Null when the trip names no last DAY (none, or
 * only a month or year) — the owner's own expiry is then the only end. A last
 * day with no zone is read where that day ends last on Earth (UTC−12), so the
 * link never ends while it is still that day somewhere.
 */
export function itineraryAutoExpiry(end: LocalDateValue | null): Date | null {
  if (!end || end.precision !== "day") return null;
  const zone = end.zone && isValidZone(end.zone) ? end.zone : "Etc/GMT+12";
  return new Date(startOfDayAt(nextDay(end.date), zone).getTime() + SHARE_LINK_ITINERARY_GRACE_MS);
}
