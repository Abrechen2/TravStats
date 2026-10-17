/**
 * A minimal RFC 5545 writer for the calendar feed (forgejo#310) — only what
 * the feed emits: one VCALENDAR of VEVENTs with timed (UTC) or all-day
 * (`VALUE=DATE`) bounds. No dependency: the format is small, and every rule a
 * calendar app is strict about is pinned by `__tests__/ics.test.ts`.
 *
 * The four rules a hand-written writer usually breaks:
 * - lines end in CRLF (§3.1), including the last one;
 * - a content line longer than 75 OCTETS is folded (§3.1) — octets, not
 *   characters: "München" is 8 octets, and folding by `.length` produced lines
 *   a strict parser refuses. A fold never splits a UTF-8 sequence;
 * - TEXT escapes backslash, semicolon, comma and newline (§3.3.11);
 * - DTSTAMP is required in every VEVENT (§3.6.1).
 */

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

/** A timed event: real instants, written in UTC. No `end`: a moment without a length. */
export interface TimedBounds {
  kind: "timed";
  start: Date;
  end: Date | null;
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

function eventLines(event: IcsEvent, stamp: string): string[] {
  const lines = [
    "BEGIN:VEVENT",
    property("UID", escapeText(event.uid)),
    property("DTSTAMP", stamp),
  ];
  if (event.bounds.kind === "timed") {
    lines.push(property("DTSTART", formatUtc(event.bounds.start)));
    if (event.bounds.end) lines.push(property("DTEND", formatUtc(event.bounds.end)));
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
    ...calendar.events.flatMap((event) => eventLines(event, stamp)),
    "END:VCALENDAR",
  ];
  return lines.join(CRLF) + CRLF;
}
