/**
 * The calendar's part of a visit suggestion (spec 2026-11-23-plugins-and-
 * calendar.md, Part A): the events of the run's days are read once, in memory,
 * and an event that belongs to a stop becomes that finding's
 * `evidence.calendar`. Nothing else of the calendar is kept anywhere — no event
 * table, no title cache. The geocoder answers through its own cache; a geocoder
 * or calendar failure leaves the day owed, never "no match".
 */
import crypto from "crypto";
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { deriveInstanceSecret } from "../../../utils/encryptionKey";
import { geocodeAddressDetailed, type GeocodeOutcome } from "../../geo/nominatim";
import { egressBlock } from "../../externalServices/egress";
import { readSourceWindow, type CalendarReadDeps } from "../../calendar/sources";
import { toCalendarError } from "../../calendar/errors";
import type { CalendarEvent } from "../../calendar/icsParse";
import { applyRules, listRules, ruleView, type CalendarRuleView } from "../../calendar/rules";
import {
  metersBetween,
  overlapMinutes,
  placeMatch,
  timeMatch,
  type MatchKind,
  type NamedPlace,
  type StopSpan,
  type TimeMatch,
} from "../../calendar/match";

/** Geocoder questions one run may ask for event locations; the rest waits (day owed). */
export const CALENDAR_GEOCODES_PER_RUN = 20;
const NEAR_DEG = 0.005;
const UID_LABEL = "travstats-calendar-uid-v1";
const GEOCODE_CACHE_MAX = 2000;
const GEOCODE_CACHE_MS = 7 * 86_400_000;

/**
 * Event locations already asked, keyed by a hash of the normalised text — the text itself is
 * kept nowhere (security review). Answers only: a failure is not cached, so it is asked again.
 */
const geocodeCache = new Map<string, { coords: { lat: number; lon: number } | null; at: number }>();
export const clearCalendarGeocodeCache = (): void => geocodeCache.clear();
const locationKey = (location: string): string =>
  crypto
    .createHash("sha256")
    .update(location.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim())
    .digest("hex");

async function cachedGeocode(
  location: string,
  geocode: (query: string) => Promise<GeocodeOutcome>
): Promise<GeocodeOutcome> {
  const key = locationKey(location);
  const hit = geocodeCache.get(key);
  if (hit && Date.now() - hit.at < GEOCODE_CACHE_MS) return { coords: hit.coords, failed: false };
  const answer = await geocode(location);
  if (!answer.failed) {
    if (geocodeCache.size >= GEOCODE_CACHE_MAX) {
      const oldest = geocodeCache.keys().next().value;
      if (oldest !== undefined) geocodeCache.delete(oldest);
    }
    geocodeCache.set(key, {
      coords: answer.coords ? { lat: answer.coords.lat, lon: answer.coords.lon } : null,
      at: Date.now(),
    });
  }
  return answer;
}

export interface DayEvent {
  sourceId: string;
  sourceLabel: string;
  event: CalendarEvent;
}

export interface CalendarDay {
  events: DayEvent[];
  /** Sources that could not be read: the run's days stay owed. */
  failed: number;
}

export interface CalendarMatchDeps {
  read?: (userId: string, window: { fromMs: number; untilMs: number }) => Promise<CalendarDay>;
  geocode?: (query: string) => Promise<GeocodeOutcome>;
  readDeps?: CalendarReadDeps;
}

export interface CalendarContext {
  userId: string;
  day: CalendarDay;
  rules: CalendarRuleView[];
  rulePlaces: Map<string, NamedPlace>;
  geocode: (query: string) => Promise<GeocodeOutcome>;
  geocodesLeft: number;
  /**
   * Whether event locations may go to the geocoder: the account's own switch (off by default)
   * and the geocoder's catalogue entry under the internet switch. Without it an event still
   * matches by an own place's or the venue's name, or a rule's place.
   */
  geocodeAllowed: boolean;
}

export interface CalendarEvidence {
  sourceId: string;
  sourceLabel: string;
  uidHash: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  /** Which of the plan's three it was: a place (geocoded, place name, rule place) or context only. */
  match: MatchKind;
  timeMatch: TimeMatch;
  overlapMinutes: number;
  geocoded?: { lat: number; lon: number; distanceM: number };
  rule?: { id: string; kind: "calendar" | "keyword"; purpose: "private" | "business" | null };
  proposedName: string;
}

export interface CalendarMatch {
  evidence: CalendarEvidence;
  purpose: "private" | "business" | null;
  name: string;
  /** Set for a place match: where the event says the visit was. */
  place: { lat: number; lon: number; placeId: string | null } | null;
}

/** The UID, keyed per account: lets a rejected finding stay rejected without keeping the UID. */
export function uidHash(userId: string, uid: string): string {
  return crypto
    .createHmac("sha256", deriveInstanceSecret(UID_LABEL))
    .update(JSON.stringify(["calendar", userId, uid]))
    .digest("hex")
    .slice(0, 32);
}

/** Every enabled source of the account for the window; a failed one is counted, not thrown. */
export async function readCalendarDay(
  userId: string,
  window: { fromMs: number; untilMs: number },
  profileZone: string,
  deps: CalendarReadDeps = {}
): Promise<CalendarDay> {
  const sources = await prisma.calendarSource.findMany({ where: { userId, enabled: true } });
  const day: CalendarDay = { events: [], failed: 0 };
  for (const source of sources) {
    try {
      const parsed = await readSourceWindow(source, window, profileZone, deps);
      for (const event of parsed.events)
        day.events.push({ sourceId: source.id, sourceLabel: source.label, event });
    } catch (error) {
      const failure = toCalendarError(error);
      // Switched off (internet, admin, incomplete): not owed — nothing could be read anyway.
      const off =
        failure.kind === "notConfigured" ||
        failure.code === "CALENDAR_EGRESS_INTERNET_OFF" ||
        failure.code === "CALENDAR_EGRESS_SERVICE_OFF";
      if (!off) day.failed++;
      logger.warn({
        operation: "calendar.readFailed",
        userId,
        sourceId: source.id,
        kind: failure.kind,
        code: failure.code,
      });
    }
  }
  return day;
}

export async function loadCalendarContext(
  userId: string,
  window: { fromMs: number; untilMs: number },
  profileZone: string,
  deps: CalendarMatchDeps = {}
): Promise<CalendarContext | null> {
  const any = await prisma.calendarSource.count({ where: { userId, enabled: true } });
  if (!any) return null;
  const day = deps.read
    ? await deps.read(userId, window)
    : await readCalendarDay(userId, window, profileZone, deps.readDeps);
  const rules = (await listRules(userId)).map(ruleView);
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { calendarGeocodeLocations: true },
  });
  const geocodeAllowed =
    settings?.calendarGeocodeLocations === true && (await egressBlock("geocoder")) === null;
  const placeIds = rules.flatMap((r) => (r.placeId ? [r.placeId] : []));
  const places = placeIds.length
    ? await prisma.place.findMany({
        where: { userId, id: { in: placeIds } },
        select: { id: true, name: true, lat: true, lon: true },
      })
    : [];
  return {
    userId,
    day,
    rules,
    rulePlaces: new Map(places.map((p) => [p.id, p])),
    geocode:
      deps.geocode ?? ((q) => geocodeAddressDetailed({ address: q }, { privateQuery: true })),
    geocodesLeft: CALENDAR_GEOCODES_PER_RUN,
    geocodeAllowed,
  };
}

async function placesBeside(userId: string, stop: StopSpan): Promise<NamedPlace[]> {
  return prisma.place.findMany({
    where: {
      userId,
      lat: { gte: stop.lat - NEAR_DEG, lte: stop.lat + NEAR_DEG },
      lon: { gte: stop.lon - NEAR_DEG * 2, lte: stop.lon + NEAR_DEG * 2 },
    },
    select: { id: true, name: true, lat: true, lon: true },
    take: 200,
  });
}

function evidenceOf(
  ctx: CalendarContext,
  candidate: DayEvent,
  stop: StopSpan,
  time: TimeMatch,
  match: MatchKind,
  rule: ReturnType<typeof applyRules>,
  geocoded: { lat: number; lon: number } | null
): CalendarEvidence {
  const e = candidate.event;
  return {
    sourceId: candidate.sourceId,
    sourceLabel: candidate.sourceLabel,
    uidHash: uidHash(ctx.userId, e.uid || `${e.startMs}:${e.title}`),
    title: e.title,
    start: new Date(e.startMs).toISOString(),
    end: new Date(e.endMs).toISOString(),
    allDay: e.allDay,
    location: e.location,
    match,
    timeMatch: time,
    overlapMinutes: overlapMinutes(e, stop),
    ...(geocoded ? { geocoded: { ...geocoded, distanceM: metersBetween(geocoded, stop) } } : {}),
    ...(rule.ruleId && rule.kind
      ? { rule: { id: rule.ruleId, kind: rule.kind, purpose: rule.purpose } }
      : {}),
    proposedName: rule.name,
  };
}

/**
 * The calendar event that belongs to the stop: the first (by shared minutes)
 * that names a place beside it, else the best one that is context only.
 * `failed`: a source or a geocoder question did not answer — the day stays owed.
 */
export async function matchStop(
  ctx: CalendarContext,
  stop: StopSpan,
  venue: NamedPlace | null
): Promise<{ match: CalendarMatch | null; failed: boolean }> {
  let failed = ctx.day.failed > 0;
  const candidates = ctx.day.events
    .flatMap((c) => {
      const time = timeMatch(c.event, stop);
      return time ? [{ c, time }] : [];
    })
    .sort((a, b) => overlapMinutes(b.c.event, stop) - overlapMinutes(a.c.event, stop));
  if (candidates.length === 0) return { match: null, failed };
  const own = candidates.some((x) => x.c.event.location)
    ? await placesBeside(ctx.userId, stop)
    : [];
  const named = venue ? [...own, venue] : own;
  let context: CalendarMatch | null = null;
  for (const { c, time } of candidates) {
    const rule = applyRules(ctx.rules, c.event, c.sourceId);
    const rulePlace = rule.placeId ? (ctx.rulePlaces.get(rule.placeId) ?? null) : null;
    let geocoded: { lat: number; lon: number } | null = null;
    const nameMatch = placeMatch(c.event, stop, { geocoded: null, named, rulePlace: null });
    // Only an event a rule selected, only with the account's switch on, and only for a stop the
    // caller has already held against the privacy zones (`handleStop` asks before anything else).
    if (c.event.location && !nameMatch && rule.ruleId && ctx.geocodeAllowed) {
      if (ctx.geocodesLeft <= 0) failed = true;
      else {
        ctx.geocodesLeft--;
        const answer = await cachedGeocode(c.event.location, ctx.geocode);
        if (answer.failed) failed = true;
        else if (answer.coords) geocoded = { lat: answer.coords.lat, lon: answer.coords.lon };
      }
    }
    const verdict = placeMatch(c.event, stop, { geocoded, named, rulePlace });
    if (verdict) {
      return {
        failed,
        match: {
          evidence: evidenceOf(ctx, c, stop, time, verdict.match, rule, geocoded),
          purpose: rule.purpose,
          name: rule.name,
          place: { lat: verdict.at.lat, lon: verdict.at.lon, placeId: verdict.placeId },
        },
      };
    }
    // An all-day event says nothing without a place.
    if (!context && !c.event.allDay)
      context = {
        evidence: evidenceOf(ctx, c, stop, time, "context", rule, geocoded),
        purpose: rule.purpose,
        name: rule.name,
        place: null,
      };
  }
  return { match: context, failed };
}

/** A finding's evidence with the calendar's match added; null when it already carries it. */
export function withCalendar(
  evidence: unknown,
  match: CalendarMatch
): Record<string, unknown> | null {
  const prior = (evidence ?? {}) as Record<string, unknown>;
  const had = prior.calendar as { uidHash?: string } | undefined;
  if (had?.uidHash === match.evidence.uidHash) return null;
  // A place match outranks a context-only one already there; never the other way round.
  if (had && (had as { match?: string }).match !== "context" && match.evidence.match === "context")
    return null;
  return {
    ...prior,
    calendar: match.evidence,
    ...(match.purpose && !prior.suggestedPurpose
      ? { suggestedPurpose: match.purpose, suggestedPurposeFrom: "calendar" }
      : {}),
  };
}
