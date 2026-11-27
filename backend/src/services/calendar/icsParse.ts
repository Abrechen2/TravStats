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
/** Rules starting earlier than this are refused: nobody's calendar needs them, a loop does. */
export const EARLIEST_RULE_YEAR = 1900;
/** Event recurrences finer than this make the library walk every minute up to the window. */
const UNSAFE_EVENT_FREQS = new Set(["SECONDLY", "MINUTELY"]);
/** A time zone changes its offset at most a few times a year: anything finer is an attack. */
const SAFE_ZONE_FREQS = new Set(["MONTHLY", "YEARLY"]);
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
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
  /**
   * Calendar objects (texts) that did not parse and were left out, by failure code. One broken
   * event must not take the rest of the calendar with it; the count says it happened.
   */
  skippedEvents?: number;
  skippedReasons?: Record<string, number>;
  /** CalDAV only: collections whose answer could not be read, with the reason. */
  failedCollections?: FailedCollection[];
}

export interface FailedCollection {
  name: string;
  code: string;
}

/** Failures that end the whole read: a budget or deadline, never one broken object. */
const READ_FATAL_CODES = new Set(["CALENDAR_PARSE_TIMEOUT", "CALENDAR_TOO_MANY_EVENTS"]);

export interface ParseOptions {
  fromMs: number;
  untilMs: number;
  profileZone: string;
  /** VEVENT components AND events produced, across every text of one read. */
  maxEvents?: number;
  maxExpansionsPerRule?: number;
  maxIterationsPerRule?: number;
  /** Relative deadline, when no absolute `deadlineAt` is given. */
  deadlineMs?: number;
  /** One absolute deadline for the whole read (epoch ms), shared by every text. */
  deadlineAt?: number;
  /** Test seam for the deadline. */
  now?: () => number;
}

/** What one read may still spend: shared by every text, so many small texts cannot add up. */
interface Budget {
  deadlineAt: number;
  components: number;
  events: number;
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

type RecurLike = { freq?: string; parts?: Record<string, unknown[]> };
const numbers = (v: unknown): number[] =>
  Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n)) : [];

/**
 * A recurrence the library would walk without ever producing an occurrence, or
 * walk minute by minute: BYMONTH + BYMONTHDAY with no real day between them
 * (30 February), BYWEEKNO outside a yearly rule, and SECONDLY/MINUTELY.
 */
export function unsafeEventRule(recur: RecurLike): boolean {
  const freq = String(recur.freq ?? "").toUpperCase();
  if (UNSAFE_EVENT_FREQS.has(freq)) return true;
  const parts = recur.parts ?? {};
  const months = numbers(parts.BYMONTH);
  const days = numbers(parts.BYMONTHDAY);
  if (months.some((m) => m < 1 || m > 12)) return true;
  if (days.some((d) => d === 0 || Math.abs(d) > 31)) return true;
  if (months.length && days.length) {
    const possible = months.some((m) => days.some((d) => Math.abs(d) <= MONTH_DAYS[m - 1]));
    if (!possible) return true;
  }
  if (numbers(parts.BYWEEKNO).length && freq !== "YEARLY") return true;
  if (numbers(parts.BYYEARDAY).some((d) => d === 0 || Math.abs(d) > 366)) return true;
  return false;
}

/** A VTIMEZONE whose STANDARD/DAYLIGHT rules recur finer than monthly: every offset lookup would expand it. */
function assertSafeTimezones(root: ICAL.Component): void {
  for (const vtz of root.getAllSubcomponents("vtimezone")) {
    for (const sub of [
      ...vtz.getAllSubcomponents("standard"),
      ...vtz.getAllSubcomponents("daylight"),
    ]) {
      for (const prop of sub.getAllProperties("rrule")) {
        const freq = String((prop.getFirstValue() as RecurLike | null)?.freq ?? "").toUpperCase();
        if (!SAFE_ZONE_FREQS.has(freq))
          throw new CalendarError("protocol", "CALENDAR_UNSAFE_TIMEZONE");
      }
    }
  }
}

/** Why a master event is not expanded at all, or null: counted with the cut rules. */
function refusedEvent(master: ICAL.Component): boolean {
  const start = master.getFirstPropertyValue("dtstart") as ICAL.Time | null;
  if (start && typeof start.year === "number" && start.year < EARLIEST_RULE_YEAR) return true;
  return master
    .getAllProperties("rrule")
    .some((p) => unsafeEventRule((p.getFirstValue() ?? {}) as RecurLike));
}

function parseOne(
  text: string,
  options: ParseOptions,
  budget: Budget,
  now: () => number
): ParsedWindow {
  const checkDeadline = () => {
    if (now() > budget.deadlineAt) throw new CalendarError("protocol", "CALENDAR_PARSE_TIMEOUT");
  };
  checkDeadline();
  budget.components -= countEvents(text);
  if (budget.components < 0) throw new CalendarError("protocol", "CALENDAR_TOO_MANY_EVENTS");
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(text) as unknown[]);
  } catch {
    throw new CalendarError("protocol", "CALENDAR_PARSE");
  }
  if (root.name !== "vcalendar") throw new CalendarError("protocol", "CALENDAR_PARSE");
  assertSafeTimezones(root);
  const vevents = root.getAllSubcomponents("vevent");

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
  const keep = (one: CalendarEvent) => {
    if (--budget.events < 0) throw new CalendarError("protocol", "CALENDAR_TOO_MANY_EVENTS");
    events.push(one);
  };

  for (const master of masters) {
    checkDeadline();
    if (String(master.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED")
      continue;
    if (refusedEvent(master)) {
      skippedRules++;
      continue;
    }
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
      if (overlaps(one, options)) keep(one);
      continue;
    }
    let iterator: ReturnType<ICAL.Event["iterator"]>;
    try {
      iterator = event.iterator();
    } catch {
      // The library refuses some BY* combinations outright: a cut rule, not a dead calendar.
      skippedRules++;
      continue;
    }
    let produced = 0;
    let reachedEnd = false;
    for (let i = 0; i < maxIterations; i++) {
      if (i % 100 === 0) checkDeadline();
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
      keep(one);
      if (++produced >= maxExpansions) {
        // More occurrences may lie inside the window: counted, so the cut is visible.
        skippedRules++;
        reachedEnd = true;
        break;
      }
    }
    if (!reachedEnd) skippedRules++;
  }
  return { events, skippedRules };
}

/**
 * Every text of ONE read (an ICS feed, or all calendar-data of all CalDAV
 * collections) under one deadline and one event budget. In-process: the caller
 * that must survive a parser stuck inside the library runs this in a worker
 * (`icsWorker.ts`), which is terminated at the same deadline.
 */
export function parseIcsTexts(texts: readonly string[], options: ParseOptions): ParsedWindow {
  const now = options.now ?? Date.now;
  const max = options.maxEvents ?? MAX_EVENTS_PER_FILE;
  const budget: Budget = {
    deadlineAt: options.deadlineAt ?? now() + (options.deadlineMs ?? PARSE_DEADLINE_MS),
    components: max,
    events: max,
  };
  const events: CalendarEvent[] = [];
  let skippedRules = 0;
  let skippedEvents = 0;
  const skippedReasons: Record<string, number> = {};
  let firstFailure: unknown = null;
  for (const text of texts) {
    let one: ParsedWindow;
    try {
      one = parseOne(text, options, budget, now);
    } catch (error) {
      const code = error instanceof CalendarError ? error.code : null;
      if (code && READ_FATAL_CODES.has(code)) throw error;
      // One unparseable calendar object is skipped and counted, never the whole read.
      firstFailure ??= error;
      skippedEvents++;
      const reason = code ?? "CALENDAR_PARSE";
      skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
      continue;
    }
    events.push(...one.events);
    skippedRules += one.skippedRules;
  }
  // Nothing parsed at all: the feed itself is broken, and that is the answer.
  if (texts.length > 0 && skippedEvents === texts.length) {
    throw firstFailure instanceof CalendarError
      ? firstFailure
      : new CalendarError("protocol", "CALENDAR_PARSE");
  }
  events.sort((a, b) => a.startMs - b.startMs);
  return { events, skippedRules, skippedEvents, skippedReasons };
}

/** One text: `parseIcsTexts` of a single feed. */
export function parseIcsWindow(text: string, options: ParseOptions): ParsedWindow {
  return parseIcsTexts([text], options);
}
