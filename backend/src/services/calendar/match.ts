/**
 * Does a calendar event belong to a TravTrack stop? (spec
 * 2026-11-23-plugins-and-calendar.md, "Matching events to stops"). Pure: the
 * caller brings the geocoded location and the places beside the stop.
 *
 *  1. Time: the spans overlap by at least half of the shorter one, or the stop
 *     starts within an hour of the event (a visit overruns its slot). An
 *     all-day event matches only together with a place.
 *  2. Place, one of: the location geocodes to within 300 m of the stop; the
 *     location text names an own place beside the stop or the venue already
 *     found; a keyword rule names an own place beside the stop.
 *  3. Without a place the event is context only: it may lend a purpose, never
 *     a place — the evidence says which of these it was.
 */
import { haversineKm } from "../../shared/geo/haversine";
import type { CalendarEvent } from "./icsParse";

export const PLACE_MATCH_M = 300;
export const START_NEAR_MS = 60 * 60_000;
export const MIN_OVERLAP_SHARE = 0.5;

export type TimeMatch = "overlap" | "startNear";
export type PlaceMatch = "geocoded" | "placeName" | "rulePlace";
export type MatchKind = PlaceMatch | "context";

export interface StopSpan {
  fromMs: number;
  untilMs: number;
  lat: number;
  lon: number;
}

export interface Located {
  lat: number;
  lon: number;
}

export interface NamedPlace extends Located {
  id: string | null;
  name: string;
}

export const metersBetween = (a: Located, b: Located): number =>
  Math.round(haversineKm(a, b) * 1000);

/** How the event's time relates to the stop, or null when it does not. */
export function timeMatch(event: CalendarEvent, stop: StopSpan): TimeMatch | null {
  const overlap = Math.min(event.endMs, stop.untilMs) - Math.max(event.startMs, stop.fromMs);
  const shorter = Math.min(event.endMs - event.startMs, stop.untilMs - stop.fromMs);
  if (event.allDay) return overlap > 0 ? "overlap" : null;
  if (shorter > 0 && overlap >= shorter * MIN_OVERLAP_SHARE) return "overlap";
  if (Math.abs(stop.fromMs - event.startMs) <= START_NEAR_MS) return "startNear";
  return null;
}

/** Lower case, accents and punctuation gone, words single-spaced. */
export function normaliseText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether a location text names a place: one contains the other as whole
 * words, or every word of the place's name (ignoring words under three letters)
 * appears in the location.
 */
export function textNames(location: string, name: string): boolean {
  const loc = ` ${normaliseText(location)} `;
  const n = normaliseText(name);
  if (!n || loc.trim() === "") return false;
  if (loc.includes(` ${n} `)) return true;
  if (` ${n} `.includes(loc)) return loc.trim().length >= 3;
  const words = n.split(" ").filter((w) => w.length >= 3);
  return words.length > 0 && words.every((w) => loc.includes(` ${w} `));
}

export interface PlaceEvidence {
  /** The geocoded location, or null when it was not asked or found nothing. */
  geocoded: Located | null;
  /** Own places beside the stop, and the venue V2 found (id null). */
  named: readonly NamedPlace[];
  /** The place a keyword rule names, when the rule has one. */
  rulePlace: NamedPlace | null;
}

export interface PlaceVerdict {
  match: PlaceMatch;
  at: Located;
  placeId: string | null;
  distanceM: number;
}

/** The place an event names beside the stop, by the plan's order, or null (context only). */
export function placeMatch(
  event: CalendarEvent,
  stop: StopSpan,
  evidence: PlaceEvidence
): PlaceVerdict | null {
  if (evidence.geocoded) {
    const d = metersBetween(evidence.geocoded, stop);
    if (d <= PLACE_MATCH_M)
      return { match: "geocoded", at: evidence.geocoded, placeId: null, distanceM: d };
  }
  if (event.location) {
    for (const p of evidence.named) {
      const d = metersBetween(p, stop);
      if (d <= PLACE_MATCH_M && textNames(event.location, p.name))
        return { match: "placeName", at: p, placeId: p.id, distanceM: d };
    }
  }
  if (evidence.rulePlace) {
    const d = metersBetween(evidence.rulePlace, stop);
    if (d <= PLACE_MATCH_M)
      return {
        match: "rulePlace",
        at: evidence.rulePlace,
        placeId: evidence.rulePlace.id,
        distanceM: d,
      };
  }
  return null;
}

/** Minutes the event and the stop share (0 when they only start near each other). */
export function overlapMinutes(event: CalendarEvent, stop: StopSpan): number {
  const ms = Math.min(event.endMs, stop.untilMs) - Math.max(event.startMs, stop.fromMs);
  return Math.max(0, Math.round(ms / 60_000));
}
