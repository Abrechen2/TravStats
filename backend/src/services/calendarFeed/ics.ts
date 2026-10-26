/**
 * A minimal RFC 5545 writer for the calendar feed (forgejo#310) — only what
 * the feed emits: one VCALENDAR of VEVENTs with timed (place-local, else UTC) or all-day
 * (`VALUE=DATE`) bounds. No dependency: the format is small, and every rule a
 * calendar app is strict about is pinned by `__tests__/ics.test.ts`.
 *
 * The rules a hand-written writer usually breaks:
 * - lines end in CRLF (§3.1), including the last one;
 * - a content line longer than 75 OCTETS is folded (§3.1) — octets, not
 *   characters: "München" is 8 octets, and folding by `.length` produced lines
 *   a strict parser refuses. A fold never splits a UTF-8 sequence;
 * - TEXT escapes backslash, semicolon, comma and newline (§3.3.11);
 * - DTSTAMP is required in every VEVENT (§3.6.1);
 * - every TZID a property names has its VTIMEZONE in the calendar (§3.2.19).
 */

import { formatParts, isValidZone, wallClockParts } from "../../shared/time/zonedParts";
import { vtimezoneLines } from "./vtimezone";

const CRLF = "\r\n";
const MAX_LINE_OCTETS = 75;

/** `YYYYMMDDTHHMMSSZ` — an instant in UTC (§3.3.5, form #2). */
export function formatUtc(instant: Date): string {
  const iso = instant.toISOString(); // 2026-10-17T12:09:37.000Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/** `YYYYMMDD` from a `YYYY-MM-DD` calendar day (§3.3.4). */
export function formatDay(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Not a calendar day: ${day}`);
  return day.replace(/-/g, "");
}

/** TEXT value escaping (§3.3.11). Other control characters are not allowed in TEXT and are dropped. */
export function escapeText(value: string): string {
  return (
    value
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r\n|\r|\n/g, "\\n")
      // eslint-disable-next-line no-control-regex -- removing control characters is the point
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
  );
}

/**
 * Folds one content line into 75-octet pieces (§3.1). Continuation lines start
 * with a single space, which counts towards their 75 octets.
 */
export function foldLine(line: string): string {
  const pieces: string[] = [];
  let current = "";
  let currentOctets = 0;
  let limit = MAX_LINE_OCTETS;
  // `for…of` walks code points, so a surrogate pair or a multi-byte character
  // is never cut in half.
  for (const char of line) {
    const octets = Buffer.byteLength(char, "utf8");
    if (currentOctets + octets > limit) {
      pieces.push(current);
      current = "";
      currentOctets = 0;
      limit = MAX_LINE_OCTETS - 1; // the leading space of the continuation
    }
    current += char;
    currentOctets += octets;
  }
  pieces.push(current);
  return pieces.join(`${CRLF} `);
}

/**
 * A timed event: real instants. No `end`: a moment without a length. Each
 * bound with a known place zone is written on that place's clock with a TZID
 * (a flight departs in Seoul's time and lands in Berlin's); without one, in UTC.
 */
export interface TimedBounds {
  kind: "timed";
  start: Date;
  end: Date | null;
  startZone?: string | null;
  endZone?: string | null;
}

/** An all-day event: calendar days, `endExclusive` the day after the last one (§3.6.1). */
export interface AllDayBounds {
  kind: "allDay";
  start: string;
  endExclusive: string;
}

export type EventBounds = TimedBounds | AllDayBounds;

export interface IcsEvent {
  /** Stable across fetches, so an edit replaces the event rather than adding a second one. */
  uid: string;
  summary: string;
  bounds: EventBounds;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  lastModified?: Date | null;
}

export interface IcsCalendar {
  name: string;
  /** How often a client should poll, in minutes (`REFRESH-INTERVAL`, RFC 7986 §5.7). */
  refreshMinutes: number;
  /** The DTSTAMP of every event: when this calendar was written. */
  generatedAt: Date;
  events: IcsEvent[];
}

const property = (name: string, value: string): string => foldLine(`${name}:${value}`);

/**
 * The UTC years a bound may be written on its place's clock in. The feed URL
 * is public and an entry's date is whatever was typed, so the VTIMEZONE span
 * is bounded: 1970–2100 (what zone data describes with any confidence), and
 * at most thirty years around the calendar's own date. A bound outside is
 * written in UTC — still the right instant, only not on the local clock.
 */
export interface ZoneWindow {
  fromYear: number;
  toYear: number;
}

export function zoneWindow(generatedAt: Date): ZoneWindow {
  const year = generatedAt.getUTCFullYear();
  return { fromYear: Math.max(1970, year - 10), toYear: Math.min(2100, year + 20) };
}

/** The zone a bound is written in, or null for UTC — an unknown zone is UTC, never a guess. */
function writableZone(
  zone: string | null | undefined,
  instant: Date,
  window: ZoneWindow
): string | null {
  const year = instant.getUTCFullYear();
  if (!zone || year < window.fromYear || year > window.toYear) return null;
  return isValidZone(zone) ? zone : null;
}

/** `NAME;TZID=Zone:YYYYMMDDTHHMMSS` on the place's clock, or `NAME:…Z` in UTC. */
function instantProperty(name: string, instant: Date, zone: string | null): string {
  const parts = zone ? wallClockParts(instant.getTime(), zone) : null;
  if (!zone || !parts) return property(name, formatUtc(instant));
  const local = formatParts(parts).replace(/[-:]/g, "");
  return property(`${name};TZID=${zone}`, local);
}

interface ZonedBounds {
  start: Date;
  end: Date | null;
  startZone: string | null;
  endZone: string | null;
}

const zonedBounds = (bounds: TimedBounds, window: ZoneWindow): ZonedBounds => ({
  start: bounds.start,
  end: bounds.end,
  startZone: writableZone(bounds.startZone, bounds.start, window),
  endZone: bounds.end ? writableZone(bounds.endZone, bounds.end, window) : null,
});

/** The UTC years each zone's bounds touch, so its VTIMEZONE covers them — and no more. */
function zoneYears(all: ZonedBounds[]): Map<string, { from: number; to: number }> {
  const years = new Map<string, { from: number; to: number }>();
  const note = (zone: string | null, instant: Date | null): void => {
    if (!zone || !instant) return;
    const year = instant.getUTCFullYear();
    const seen = years.get(zone);
    years.set(zone, {
      from: Math.min(seen?.from ?? year, year),
      to: Math.max(seen?.to ?? year, year),
    });
  };
  for (const b of all) {
    note(b.startZone, b.start);
    note(b.endZone, b.end);
  }
  return years;
}

function timezoneLines(all: ZonedBounds[]): string[] {
  return [...zoneYears(all)]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([zone, { from, to }]) => vtimezoneLines(zone, from, to) ?? []);
}

function eventLines(event: IcsEvent, stamp: string, window: ZoneWindow): string[] {
  const lines = [
    "BEGIN:VEVENT",
    property("UID", escapeText(event.uid)),
    property("DTSTAMP", stamp),
  ];
  if (event.bounds.kind === "timed") {
    const { start, end, startZone, endZone } = zonedBounds(event.bounds, window);
    lines.push(instantProperty("DTSTART", start, startZone));
    if (end) lines.push(instantProperty("DTEND", end, endZone));
  } else {
    lines.push(property("DTSTART;VALUE=DATE", formatDay(event.bounds.start)));
    lines.push(property("DTEND;VALUE=DATE", formatDay(event.bounds.endExclusive)));
    // An all-day entry (a stay, a station) should not block the day as busy.
    lines.push(property("TRANSP", "TRANSPARENT"));
  }
  lines.push(property("SUMMARY", escapeText(event.summary)));
  if (event.location) lines.push(property("LOCATION", escapeText(event.location)));
  if (event.description) lines.push(property("DESCRIPTION", escapeText(event.description)));
  // A URI value (§3.3.13) is not TEXT: escaping its commas would change the address.
  if (event.url) lines.push(property("URL", event.url.replace(/[\r\n]/g, "")));
  if (event.lastModified) lines.push(property("LAST-MODIFIED", formatUtc(event.lastModified)));
  lines.push("END:VEVENT");
  return lines;
}

/** The whole calendar as one string, CRLF-terminated. */
export function writeCalendar(calendar: IcsCalendar): string {
  const stamp = formatUtc(calendar.generatedAt);
  const window = zoneWindow(calendar.generatedAt);
  const ttl = `PT${calendar.refreshMinutes}M`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TravStats//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    property("NAME", escapeText(calendar.name)),
    property("X-WR-CALNAME", escapeText(calendar.name)),
    `REFRESH-INTERVAL;VALUE=DURATION:${ttl}`,
    `X-PUBLISHED-TTL:${ttl}`,
    ...timezoneLines(
      calendar.events.flatMap((e) =>
        e.bounds.kind === "timed" ? [zonedBounds(e.bounds, window)] : []
      )
    ),
    ...calendar.events.flatMap((event) => eventLines(event, stamp, window)),
    "END:VCALENDAR",
  ];
  return lines.join(CRLF) + CRLF;
}
