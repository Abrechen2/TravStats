import { localDay, toLocal } from "../../shared/time/instant";
import { fakeUtcToInstant, startOfDayAt } from "../../shared/time/legacyValues";
import type { TimePrecision } from "../../shared/time/wire";
import type { TimeMigrationReason } from "../../schemas/timeMigration";

/**
 * Who wrote a legacy `PlaceVisit.visitedAt`, and what it therefore means
 * (ADR 0002 Q4, plan phase 3b). The web stored the place's wall clock as fake
 * UTC and always at a whole minute (`…:00.000Z`); the Companion stored a real
 * instant from `toISOString()`, with seconds and milliseconds. Once written
 * the two look alike, so the writer is established in this order, and where
 * it cannot be, the day is kept and the time of day marked unknown — never
 * guessed.
 *
 * 1. `written_via`, when a phase-2 write recorded it.
 * 2. Written before the Companion could write visits (2026-08-29), or before
 *    the user's first paired device → the web (fake UTC).
 * 3. After the first pairing, with seconds or milliseconds → the Companion.
 * 4. (Request-log correlation is not implemented: the logs are not in the
 *    database, and a missing log would read as "no Companion".)
 * 5. Otherwise unknown.
 *
 * One deviation from the plan's step 2, on the side of not guessing: a user
 * with NO paired device on record whose value carries seconds after
 * 2026-08-29 is unknown, not web — a device token can be deleted, and the web
 * never wrote seconds.
 */

/** The first Companion commit that wrote place visits. */
export const COMPANION_VISITS_SINCE = new Date("2026-08-29T00:00:00.000Z");

export type VisitWriter = "web" | "companion" | "unknown";

export type VisitRule =
  | "visit.written_via"
  | "visit.before_companion"
  | "visit.companion_instant"
  | "visit.writer_unknown"
  | "visit.zone_unresolved";

export interface VisitLegacyInput {
  stored: Date;
  createdAt: Date;
  writtenVia: string | null;
  /** When the user's first paired device token was minted; null = never. */
  firstDeviceAt: Date | null;
  /** The place's zone; null when it has none. */
  zone: string | null;
}

export interface VisitReading {
  writer: VisitWriter;
  rule: VisitRule;
  /** `visited_at_utc`; null only without a zone. */
  utc: Date | null;
  precision: TimePrecision;
  /** The local day the visit is kept on; null without a zone. */
  day: string | null;
  /** Set when the value is left open for the owner. */
  reason: TimeMigrationReason | null;
}

const WALL_CLOCK_WRITERS = new Set(["web", "import", "suggestion"]);
const INSTANT_WRITERS = new Set(["companion", "api"]);

function hasSubMinute(value: Date): boolean {
  return value.getTime() % 60_000 !== 0;
}

function writerOf(input: VisitLegacyInput): { writer: VisitWriter; rule: VisitRule } {
  const { stored, createdAt, writtenVia, firstDeviceAt } = input;
  if (writtenVia && WALL_CLOCK_WRITERS.has(writtenVia)) {
    return { writer: "web", rule: "visit.written_via" };
  }
  if (writtenVia && INSTANT_WRITERS.has(writtenVia)) {
    return { writer: "companion", rule: "visit.written_via" };
  }
  if (createdAt < COMPANION_VISITS_SINCE) return { writer: "web", rule: "visit.before_companion" };
  if (firstDeviceAt && createdAt < firstDeviceAt) {
    return { writer: "web", rule: "visit.before_companion" };
  }
  if (!firstDeviceAt && !hasSubMinute(stored)) {
    return { writer: "web", rule: "visit.before_companion" };
  }
  if (firstDeviceAt && hasSubMinute(stored)) {
    return { writer: "companion", rule: "visit.companion_instant" };
  }
  return { writer: "unknown", rule: "visit.writer_unknown" };
}

/** The day kept for a value whose writer is unknown (plan step 5). */
function unknownWriterDay(stored: Date, zone: string): string {
  const readsAsLocalMidnight = toLocal(stored, zone).local.endsWith("T00:00:00");
  return readsAsLocalMidnight ? localDay(stored, zone) : stored.toISOString().slice(0, 10);
}

export function readLegacyVisit(input: VisitLegacyInput): VisitReading {
  const { writer, rule } = writerOf(input);
  const { stored, zone } = input;
  if (!zone) {
    return {
      writer,
      rule: "visit.zone_unresolved",
      utc: null,
      precision: "unknown",
      day: null,
      reason: "zone_unresolved",
    };
  }
  if (writer === "companion") {
    return {
      writer,
      rule,
      utc: stored,
      precision: "minute",
      day: localDay(stored, zone),
      reason: null,
    };
  }
  if (writer === "unknown") {
    const day = unknownWriterDay(stored, zone);
    return {
      writer,
      rule,
      utc: startOfDayAt(day, zone),
      precision: "unknown",
      day,
      reason: "writer_unknown",
    };
  }
  const reading = fakeUtcToInstant(stored, zone);
  const day = reading.local.slice(0, 10);
  if (reading.status === "nonexistent") {
    return {
      writer,
      rule,
      utc: startOfDayAt(day, zone),
      precision: "unknown",
      day,
      reason: "local_time_nonexistent",
    };
  }
  // The web wrote a visit without a time as that day's `T00:00`: a day, not a minute.
  const precision: TimePrecision = reading.local.endsWith("T00:00:00") ? "day" : "minute";
  return { writer, rule, utc: reading.utc, precision, day, reason: null };
}
