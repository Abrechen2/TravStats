/**
 * An iCalendar text read into the events of ONE window, in memory (spec
 * 2026-11-23-plugins-and-calendar.md, Part A "Reading, without keeping the
 * calendar"). Nothing here is stored; the caller holds the result for the
 * length of one job.
 *
 * Times: a DTSTART with an IANA TZID is placed through `shared/time` (the
 * one rule for the whole app, ADR 0002), a TZID the file itself defines in a
 * VTIMEZONE (Outlook's "W. Europe Standard Time") through that definition, a
 * UTC time as itself, and a floating one in the profile zone. An all-day event
 * is a local date in the profile zone and keeps its dates beside the span.
 *
 * Bounded (security review): the number of events in the file, the
 * occurrences one rule may produce inside the window, the iterations one rule
 * may take to reach the window, and the wall time of the whole parse. Every
 * bound that cuts is reported, never silent: a file over the event cap is a
 * failure, a rule that could not reach the window is counted in `skippedRules`.
 */
import ICAL from "ical.js";
import { isValidZone } from "../../shared/time/zonedParts";
import { machineInstant } from "../../shared/time/instant";
import { CalendarError } from "./errors";

export const MAX_EVENTS_PER_FILE = 10_000;
export const MAX_EXPANSIONS_PER_RULE = 500;
/** Iterations a rule may spend before it reaches the window (a daily rule from 1990 is ~13 000). */
export const MAX_ITERATIONS_PER_RULE = 20_000;
export const PARSE_DEADLINE_MS = 5_000;
const TEXT_CAP = 500;
const DAY_MS = 86_400_000;

export interface CalendarEvent {
  uid: string;
  title: string;
  location: string | null;
  startMs: number;
  endMs: number;
  allDay: boolean;
  /** All-day only: the local dates, end exclusive. */
  startDay: string | null;
  endDay: string | null;
}

export interface ParsedWindow {
  events: CalendarEvent[];
  /**
   * Rules cut short: out of iterations before the window's end, or at the occurrence cap inside
   * it. Their later occurrences are missing, and the caller says so.
   */
  skippedRules: number;
}

export interface ParseOptions {
  fromMs: number;
  untilMs: number;
  profileZone: string;
  maxEvents?: number;
  maxExpansionsPerRule?: number;
  maxIterationsPerRule?: number;
  deadlineMs?: number;
  /** Test seam for the deadline. */
  now?: () => number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const wall = (t: ICAL.Time) =>
  `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}T${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
const dateOf = (t: ICAL.Time) => `${pad(t.year, 4)}-${pad(t.month)}-${pad(t.day)}`;
const cap = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, TEXT_CAP) : null;
};

/** The instant an ICAL time names, in milliseconds. */
function instantOf(t: ICAL.Time, profileZone: string, tzidParam?: string | null): number {
  if (t.isDate)
    return (machineInstant(`${dateOf(t)}T00:00:00`, profileZone) ?? new Date(0)).getTime();
  const zone = t.zone as (ICAL.Timezone & { component?: unknown }) | undefined;
  // A TZID the file does not define leaves the parsed time floating: the parameter names the zone.
  const tzid =
    zone === ICAL.Timezone.utcTimezone
      ? "UTC"
      : zone?.component
        ? zone.tzid
        : tzidParam || zone?.tzid;
  if (tzid === "UTC" || zone === ICAL.Timezone.utcTimezone)
    return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  if (tzid && tzid !== "floating" && isValidZone(tzid)) {
    const at = machineInstant(wall(t), tzid);
    if (at) return at.getTime();
  }
  if (zone && zone.component) {
    const offsetSeconds = zone.utcOffset(t);
    return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second) - offsetSeconds * 1000;
  }
  const floating = machineInstant(wall(t), profileZone);
  return (floating ?? new Date(0)).getTime();
}

function eventOf(
  item: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time | null,
  profileZone: string
): CalendarEvent {
  const allDay = start.isDate;
  const tzidOf = (name: string) => {
    const value = item.component.getFirstProperty(name)?.getParameter("tzid");
    return typeof value === "string" ? value : null;
  };
  const startZone = tzidOf("dtstart");
  const endZone = tzidOf("dtend") ?? startZone;
  const startMs = instantOf(start, profileZone, startZone);
  let endMs: number;
  let endDay: string | null = null;
  if (allDay) {
    const endTime = end && end.isDate && end.compare(start) > 0 ? end : null;
    endDay = endTime ? dateOf(endTime) : null;
    endMs = endTime ? instantOf(endTime, profileZone, endZone) : startMs + DAY_MS;
    if (!endDay) {
      const next = start.clone();
      next.adjust(1, 0, 0, 0);
      endDay = dateOf(next);
    }
  } else {
    endMs = end ? instantOf(end, profileZone, endZone) : startMs;
    if (endMs < startMs) endMs = startMs;
  }
  return {
    uid: (cap(item.uid) ?? "").slice(0, 200),
    title: cap(item.summary) ?? "",
    location: cap(item.location),
    startMs,
    endMs,
    allDay,
    startDay: allDay ? dateOf(start) : null,
    endDay,
  };
}

const overlaps = (e: CalendarEvent, o: ParseOptions) => e.endMs > o.fromMs && e.startMs < o.untilMs;

/** Cheap pre-count, before the parser builds a tree for an oversized file. */
function countEvents(text: string): number {
  return (text.match(/^BEGIN:VEVENT\s*$/gim) ?? []).length;
}

export function parseIcsWindow(text: string, options: ParseOptions): ParsedWindow {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.deadlineMs ?? PARSE_DEADLINE_MS);
  const maxEvents = options.maxEvents ?? MAX_EVENTS_PER_FILE;
  if (countEvents(text) > maxEvents)
    throw new CalendarError("protocol", "CALENDAR_TOO_MANY_EVENTS");
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text) as unknown[]);
  } catch {
    throw new CalendarError("protocol", "CALENDAR_PARSE");
  }
  if (root.name !== "vcalendar") throw new CalendarError("protocol", "CALENDAR_PARSE");
  const vevents = root.getAllSubcomponents("vevent");
  if (vevents.length > maxEvents) throw new CalendarError("protocol", "CALENDAR_TOO_MANY_EVENTS");

  // A changed occurrence (RECURRENCE-ID) belongs to its master; the master's iterator replaces it.
  const masters: ICAL.Component[] = [];
  const exceptions = new Map<string, ICAL.Component[]>();
  for (const c of vevents) {
    const uid = String(c.getFirstPropertyValue("uid") ?? "");
    if (c.hasProperty("recurrence-id")) {
      exceptions.set(uid, [...(exceptions.get(uid) ?? []), c]);
    } else masters.push(c);
  }

  const events: CalendarEvent[] = [];
  let skippedRules = 0;
  const maxExpansions = options.maxExpansionsPerRule ?? MAX_EXPANSIONS_PER_RULE;
  const maxIterations = options.maxIterationsPerRule ?? MAX_ITERATIONS_PER_RULE;
  const checkDeadline = () => {
    if (now() > deadline) throw new CalendarError("protocol", "CALENDAR_PARSE_TIMEOUT");
  };

  for (const master of masters) {
    checkDeadline();
    if (String(master.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED")
      continue;
    let event: ICAL.Event;
    try {
      event = new ICAL.Event(master, {
        exceptions: exceptions.get(String(master.getFirstPropertyValue("uid") ?? "")) ?? [],
      });
    } catch {
      continue;
    }
    if (!event.startDate) continue;
    if (!event.isRecurring()) {
      const one = eventOf(event, event.startDate, event.endDate ?? null, options.profileZone);
      if (overlaps(one, options)) events.push(one);
      continue;
    }
    const iterator = event.iterator();
    let produced = 0;
    let reachedEnd = false;
    for (let i = 0; i < maxIterations; i++) {
      if (i % 500 === 0) checkDeadline();
      const next = iterator.next();
      if (!next) {
        reachedEnd = true;
        break;
      }
      const details = event.getOccurrenceDetails(next);
      const item = details.item;
      if (
        String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED"
      )
        continue;
      const one = eventOf(item, details.startDate, details.endDate, options.profileZone);
      // Occurrences come in start order: once one starts after the window, none later is inside.
      if (one.startMs >= options.untilMs) {
        reachedEnd = true;
        break;
      }
      if (!overlaps(one, options)) continue;
      events.push(one);
      if (++produced >= maxExpansions) {
        // More occurrences may lie inside the window: counted, so the cut is visible.
        skippedRules++;
        reachedEnd = true;
        break;
      }
    }
    if (!reachedEnd) skippedRules++;
  }
  events.sort((a, b) => a.startMs - b.startMs);
  return { events, skippedRules };
}
