import { instantOfFakeUtc, fakeUtcOf, type ResolvedTime } from "../../shared/time/resolveInput";
import { toDbDate } from "../../shared/time/localDate";
import { toInstant } from "../../shared/time/instant";
import type { TimePrecision } from "../../shared/time/wire";
import { zoneOf } from "../../shared/time/zoneOf";

/**
 * The time columns of a place visit, legacy and new together (ADR 0002
 * phase 2 dual-write). Every writer of `PlaceVisit` builds them here, so the
 * legacy `visitedAt` (the place's wall clock as fake UTC — the web meaning)
 * and the new instant/zone/precision cannot disagree.
 */

export interface VisitTimeColumns {
  visitedAt: Date | null;
  visitedAtUtc: Date | null;
  visitedZone: string | null;
  visitedPrecision: TimePrecision | null;
}

export const NO_VISIT_TIME: VisitTimeColumns = {
  visitedAt: null,
  visitedAtUtc: null,
  visitedZone: null,
  visitedPrecision: null,
};

/** From an inbound time the route resolved. */
export function visitColumnsFromResolved(resolved: ResolvedTime | null): VisitTimeColumns {
  if (!resolved) return NO_VISIT_TIME;
  return {
    visitedAt: fakeUtcOf(resolved),
    visitedAtUtc: resolved.utc,
    visitedZone: resolved.zone,
    visitedPrecision: resolved.precision,
  };
}

/**
 * From a legacy fake-UTC value (importers, seeds). Without a zone for the
 * place the instant cannot be known: the legacy value is kept and the new
 * columns say `unknown` rather than inventing UTC (D2).
 */
export function visitColumnsFromFakeUtc(
  fakeUtc: Date | null,
  place: { lat: number | null; lon: number | null },
  precision: TimePrecision = "minute"
): VisitTimeColumns {
  if (!fakeUtc) return NO_VISIT_TIME;
  const zone = zoneOf(place);
  if (!zone) {
    return {
      visitedAt: fakeUtc,
      visitedAtUtc: null,
      visitedZone: null,
      visitedPrecision: "unknown",
    };
  }
  return {
    visitedAt: fakeUtc,
    visitedAtUtc: instantOfFakeUtc(fakeUtc, zone),
    visitedZone: zone,
    visitedPrecision: precision,
  };
}

/**
 * A visit known only to the day (a suggestion accepted, a checklist tick): the
 * legacy column gets the web's shape for that (`dayT00:00Z`), the instant is
 * the day's start at the place, precision `day`.
 */
export function visitColumnsFromDay(
  day: string,
  place: { lat: number | null; lon: number | null }
): VisitTimeColumns {
  const zone = zoneOf(place);
  return {
    visitedAt: toDbDate(day),
    visitedAtUtc: zone ? toInstant(`${day}T00:00`, zone, { origin: "machine" }).utc : null,
    visitedZone: zone,
    visitedPrecision: zone ? "day" : "unknown",
  };
}

/**
 * A visit dated by an ACCEPTED SUGGESTION (a checklist tick): the suggestion
 * names the day of its evidence — a stay's check-in, a port call, a photo —
 * and its ISO string mixes the anchors' meanings (a UTC-midnight day, a
 * fake-UTC port clock, a real photo instant). Reading it as an instant would
 * move a New York stay's visit to the evening before. So the legacy column
 * keeps the value verbatim, as it always did, and the new columns record
 * what the evidence actually establishes: the day, precision `day`.
 */
export function visitColumnsFromSuggestedInstant(
  sent: Date,
  place: { lat: number | null; lon: number | null }
): VisitTimeColumns {
  return { ...visitColumnsFromDay(sent.toISOString().slice(0, 10), place), visitedAt: sent };
}
