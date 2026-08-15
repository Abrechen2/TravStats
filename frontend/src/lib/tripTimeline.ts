/**
 * Date + time handling for the trip timeline (#175).
 *
 * TIME MODEL — read this before changing anything here.
 *
 * A trip stop's time is a WALL CLOCK at the place it happened: "we were at the
 * Louvre at 14:00" means 14:00 in Paris, not 14:00 in whatever zone the reader
 * is sitting in. `TripStop` carries no timezone column, and giving it one would
 * mean resolving a zone for every dropped pin.
 *
 * So the time is stored TIMEZONE-NAIVE, pinned to UTC: what the user typed is
 * written as `...THH:mm:00.000Z` and read back formatted in UTC. It round-trips
 * exactly, and every viewer sees the number that was entered — which is what
 * "we were there at 14:00" is supposed to mean.
 *
 * The alternative — storing a real instant and rendering it locally — is what
 * made a JFK arrival read six hours off in this very timeline before 2.5.0.
 * Do NOT "fix" these functions by switching them to local formatting.
 *
 * A stop with no time given is stored at exactly midnight UTC, the same
 * date-only convention cruise dates and lodging check-ins already use. That is
 * why `hasExplicitTime` treats midnight as "no time": without a separate
 * column, the two are indistinguishable, and showing "00:00" on every
 * time-less stop would be noise on the overwhelming majority of them.
 */

/** Splits a stored ISO instant into the two form inputs, both in UTC. */
export function splitDateTimeInput(iso: string | null | undefined): {
  date: string;
  time: string;
} {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const date = d.toISOString().slice(0, 10);
  const time = hasExplicitTime(iso) ? d.toISOString().slice(11, 16) : "";
  return { date, time };
}

/**
 * Builds the stored instant from the two form inputs.
 *
 * An empty time means "no time given" and yields midnight UTC. An empty date
 * yields null whatever the time says — a time without a day cannot be placed
 * on a timeline.
 */
export function joinDateTimeInput(
  date: string,
  time: string,
): string | null {
  if (!date.trim()) return null;
  const t = time.trim() === "" ? "00:00" : time.trim();
  const iso = `${date.trim()}T${t}:00.000Z`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** True when the instant carries a time of day, i.e. is not midnight UTC. */
export function hasExplicitTime(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0;
}

/** The stop's calendar day in UTC ("2026-05-01"), for same-day grouping. */
export function utcDayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * "01.05.2026" or "01.05.2026, 14:30" — always in UTC, per the time model
 * above. Falls back to the raw string rather than rendering "Invalid Date".
 */
export function formatTimelineDate(iso: string, language: string | undefined): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const locale = language?.toLowerCase().startsWith("en") ? "en-US" : "de-DE";
  const datePart = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
  if (!hasExplicitTime(iso)) return datePart;
  const timePart = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    hour12: false,
  }).format(d);
  return `${datePart}, ${timePart}`;
}

/** The kinds the timeline sorts, as far as ordering cares. */
export interface SortableEvent {
  date: string;
  kind: string;
}

/**
 * Where an event sits within its day when it carries NO time of day.
 *
 * Midnight means "no time given" (see `hasExplicitTime`) — but sorting by the
 * stored instant reads it as 00:00, the EARLIEST moment of the day. That put
 * a hotel check-in above the flight that landed at 07:45 and brought the
 * traveller there, on the owner's Madagascar trip. Every lodging stay is
 * stored this way, so the misordering was general, not one bad row.
 *
 * A day without recorded times still has a shape: you leave the hotel, you
 * travel, you arrive somewhere and check in, and you write the day up at its
 * end. That shape is what these ranks encode — and only for events whose time
 * is genuinely unknown. A check-in that DOES carry a time keeps its place in
 * the clock order; the rank is a fallback for missing information, never an
 * override of information we have.
 */
function dayRank(ev: SortableEvent): number {
  if (ev.kind === "journal") return 3; // always the day's last word — #175
  if (hasExplicitTime(ev.date)) return 1;
  if (ev.kind === "lodging-checkout") return 0; // you leave before you travel
  if (ev.kind === "lodging-checkin") return 2; // you arrive before you settle
  return 1;
}

/**
 * Chronological order, with three deliberate tie-breaks.
 *
 * 1. A DIARY entry sorts after everything else on the same calendar day —
 *    Alex's request (#175): "Diary entries should always be the last entry of
 *    a day". A day's write-up is about the day, so it belongs at its end. He
 *    offered a settings toggle as an alternative; this ships the fixed rule,
 *    which is the behaviour he named first and costs the user no decision.
 * 2. A time-less check-in or check-out is placed by `dayRank` rather than by
 *    its midnight instant — see there for why.
 * 3. Otherwise ties keep their original relative order (the comparator returns
 *    0 and Array.prototype.sort is stable), so two stops entered for the same
 *    time stay in the order the backend returned them — which is `orderIdx`.
 *
 * All three apply WITHIN a day only. Across days the instants decide, so a
 * check-in on the 1st can never be dragged past anything on the 2nd.
 */
export function compareTimelineEvents(a: SortableEvent, b: SortableEvent): number {
  const ta = new Date(a.date).getTime();
  const tb = new Date(b.date).getTime();

  if (utcDayOf(a.date) === utcDayOf(b.date)) {
    const ra = dayRank(a);
    const rb = dayRank(b);
    if (ra !== rb) return ra - rb;
  }

  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return ta - tb;
}
