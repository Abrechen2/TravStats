import { haversineKm } from "../../shared/geo/haversine";
import { AWAY_KM } from "../../shared/tripSuggestionRules";
import { addDays, dayDiff } from "./time";
import type { Coordinate, SuggestionKind } from "./types";

/**
 * The rejection memory (trip suggestions v2, owner 2026-11-23: "a rejected
 * proposal must never nag").
 *
 * A dismissal is remembered as the DAYS it covered and the home it was judged
 * against — not as the member set, whose every edit (one more hotel, a date
 * shifted by a day) used to make it a new question. A later candidate that
 * overlaps a dismissed span by one day or more stays quiet, unless it has grown
 * past double the rejected length; then it is asked once more, flagged
 * `expanded`, and its dismissal covers the larger span from then on. During the
 * account's quiet period after a dismissal not even that is asked.
 *
 * Pure: the engine and the TravTrack stream call it with the same decisions.
 */

/** How many times the rejected length a candidate must exceed to be asked again. */
export const EXPANDED_FACTOR = 2;
export const DEFAULT_QUIET_DAYS = 14;
export const MAX_QUIET_DAYS = 90;

/** The two families a span suppresses within. */
export type SpanFamily = "trip" | "place";

export interface SpanDecision {
  family: SpanFamily;
  /** place family: the place. trip family: unused. */
  targetId: string | null;
  startDay: string;
  endDay: string;
  /** UTC day the answer was given. */
  decidedDay: string;
  homeSignature: string | null;
}

export interface SpanCandidate {
  family: SpanFamily;
  targetId: string | null;
  startDay: string;
  endDay: string;
  homeSignature: string | null;
}

export type SpanVerdict = "suppressed" | "expanded" | "open";

export function familyOf(kind: SuggestionKind): SpanFamily {
  return kind === "place_visit" ? "place" : "trip";
}

/** `lat,lon` to two decimals — about a kilometre, enough to tell two homes apart. */
export function homeSignature(home: Coordinate | null): string | null {
  return home ? `${home.lat.toFixed(2)},${home.lon.toFixed(2)}` : null;
}

function parseSignature(sig: string): Coordinate | null {
  const [lat, lon] = sig.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/**
 * Same home, or not known on one side. Only two KNOWN homes farther apart than
 * the away radius make an old rejection about a different absence — the user
 * moved, and the same days are a different question.
 */
export function sameHome(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return true;
  const pa = parseSignature(a);
  const pb = parseSignature(b);
  if (!pa || !pb) return true;
  return haversineKm(pa, pb) <= AWAY_KM;
}

export const spanDays = (s: { startDay: string; endDay: string }): number =>
  dayDiff(s.startDay, s.endDay) + 1;

export function overlapDays(
  a: { startDay: string; endDay: string },
  b: { startDay: string; endDay: string }
): number {
  const start = a.startDay > b.startDay ? a.startDay : b.startDay;
  const end = a.endDay < b.endDay ? a.endDay : b.endDay;
  return start > end ? 0 : dayDiff(start, end) + 1;
}

/**
 * What the memory says about one candidate. Any dismissal that suppresses it
 * wins over one that would let it through as expanded.
 */
export function judgeSpan(
  candidate: SpanCandidate,
  decisions: readonly SpanDecision[],
  today: string,
  quietDays: number
): SpanVerdict {
  let verdict: SpanVerdict = "open";
  for (const d of decisions) {
    if (d.family !== candidate.family) continue;
    if (d.family === "place" && d.targetId !== candidate.targetId) continue;
    if (overlapDays(d, candidate) < 1) continue;
    if (!sameHome(d.homeSignature, candidate.homeSignature)) continue;
    const quiet = today < addDays(d.decidedDay, quietDays);
    const grown = spanDays(candidate) > EXPANDED_FACTOR * spanDays(d);
    if (quiet || !grown) return "suppressed";
    verdict = "expanded";
  }
  return verdict;
}

export function clampQuietDays(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return DEFAULT_QUIET_DAYS;
  return Math.min(MAX_QUIET_DAYS, Math.max(0, Math.round(value)));
}
