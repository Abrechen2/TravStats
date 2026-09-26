import { InvalidLocalTimeError, LocalTimeNonexistentError, ZoneUnknownError } from "./errors";
import {
  formatOffset,
  formatParts,
  isValidZone,
  offsetMsAt,
  partsToUtcMs,
  wallClockParts,
  type WallClockParts,
} from "./zonedParts";

/**
 * Wall clock ⇄ instant, the only conversion in the server (ADR 0002 D3/D5).
 *
 * MIRRORED (display half: `toLocal`, `localDay`) at
 * `frontend/src/shared/time/` — change both together. Both are held to
 * `shared/time/vectors.json` at the repository root.
 */

/** Who produced a wall clock — decides what a spring-forward gap means. */
export type LocalTimeOrigin = "typed" | "machine";

/** Which occurrence of a repeated (autumn) hour. Owner decision Q5: earlier by default. */
export type Fold = "earlier" | "later";

export interface ToInstantOptions {
  fold?: Fold;
  origin?: LocalTimeOrigin;
}

export interface InstantResult {
  utc: Date;
  /** The offset in force at `utc`, e.g. `+02:00`. */
  offset: string;
  /** The wall clock happened twice; `fold` chose which. */
  ambiguous: boolean;
}

export interface LocalResult {
  /** `YYYY-MM-DDTHH:mm:ss` as the place's clock showed it. */
  local: string;
  offset: string;
}

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Parses `YYYY-MM-DDTHH:mm[:ss]`; refuses anything else, including 2027-02-30 and 24:00. */
export function parseLocal(local: string): WallClockParts {
  const match = LOCAL_PATTERN.exec(local);
  if (!match) throw new InvalidLocalTimeError(local);
  const [year, month, day, hour, minute, second] = match.slice(1).map((v) => Number(v ?? 0));
  const parts = { year, month, day, hour, minute, second };
  // Date.UTC normalises overflow (Feb 30 → Mar 2); reading it back catches it.
  const check = new Date(partsToUtcMs(parts));
  const intact =
    check.getUTCFullYear() === year &&
    check.getUTCMonth() + 1 === month &&
    check.getUTCDate() === day &&
    check.getUTCHours() === hour &&
    check.getUTCMinutes() === minute &&
    check.getUTCSeconds() === second;
  if (!intact) throw new InvalidLocalTimeError(local);
  return parts;
}

function requireZone(zone: string): void {
  if (!isValidZone(zone)) throw new ZoneUnknownError(zone);
}

const HOUR_MS = 3_600_000;
/**
 * Offsets are sampled ±18 h around the reading, every 3 h. Every instant a
 * wall clock can name lies within ±14 h of it (the widest offsets on Earth),
 * so ±18 h sees both sides of any transition that could touch it — including
 * Samoa's 24-hour jump, whose two offsets are −10 and +14.
 */
const SAMPLE_OFFSETS_H = [-18, -15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15, 18];

function candidateOffsets(guessMs: number, zone: string): number[] {
  const seen = new Set<number>();
  for (const h of SAMPLE_OFFSETS_H) {
    const offset = offsetMsAt(guessMs + h * HOUR_MS, zone);
    if (offset !== null) seen.add(offset);
  }
  return [...seen];
}

/**
 * The instant a wall clock in a zone names.
 *
 * - An hour that happens twice (autumn) → the earlier occurrence, or the
 *   later with `fold: "later"`; `ambiguous: true` either way.
 * - An hour the zone skips (spring): refused with `LOCAL_TIME_NONEXISTENT`
 *   when a person typed it — it is on no clock, and guessing moves what they
 *   meant. A MACHINE source (GPS, EXIF, provider feed) is never refused: a
 *   background sync must not fail on the one hour a year that does not exist.
 *   It lands where a clock that was not yet turned forward would put it —
 *   02:30 in Berlin's gap becomes 01:30Z, which that clock shows as 03:30.
 */
export function toInstant(
  local: string,
  zone: string,
  options: ToInstantOptions = {}
): InstantResult {
  requireZone(zone);
  const { fold = "earlier", origin = "typed" } = options;
  const guessMs = partsToUtcMs(parseLocal(local));
  const offsets = candidateOffsets(guessMs, zone);

  const matches = offsets
    .map((offset) => guessMs - offset)
    .filter((instantMs) => offsetMsAt(instantMs, zone) === guessMs - instantMs)
    .sort((a, b) => a - b);

  let utcMs: number;
  if (matches.length === 0) {
    if (origin === "typed") throw new LocalTimeNonexistentError(local, zone);
    // Spring forward always raises the offset, so the smaller one is the
    // offset in force before the gap.
    utcMs = guessMs - Math.min(...offsets);
  } else {
    utcMs = fold === "later" ? matches[matches.length - 1] : matches[0];
  }

  return {
    utc: new Date(utcMs),
    offset: formatOffset(offsetMsAt(utcMs, zone) as number),
    ambiguous: matches.length > 1,
  };
}

function instantMs(utc: Date | string): number {
  const ms = typeof utc === "string" ? Date.parse(utc) : utc.getTime();
  if (!Number.isFinite(ms)) throw new InvalidLocalTimeError(String(utc));
  return ms;
}

/** The wall clock and offset an instant shows in a zone. */
export function toLocal(utc: Date | string, zone: string): LocalResult {
  requireZone(zone);
  const ms = instantMs(utc);
  const parts = wallClockParts(ms, zone) as WallClockParts;
  return {
    local: formatParts(parts),
    offset: formatOffset(offsetMsAt(ms, zone) as number),
  };
}

/** The calendar day (`YYYY-MM-DD`) an instant falls on in a zone. */
export function localDay(utc: Date | string, zone: string): string {
  return toLocal(utc, zone).local.slice(0, 10);
}
