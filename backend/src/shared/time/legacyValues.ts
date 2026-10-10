import { LocalTimeNonexistentError } from "./errors";
import { toInstant } from "./instant";

/**
 * How the phase-3b backfill reads a value written before the time model
 * (ADR 0002). Two readings, each a rule the vectors pin:
 *
 * - a DAY stored in a `DateTime` column (`legacyDayOf`), and
 * - a WALL CLOCK stored as if it were UTC — "fake UTC" (`fakeUtcToInstant`).
 *
 * Neither guesses. What cannot be read without guessing comes back marked,
 * and the backfill reports it instead of deciding.
 */

export type LegacyDayRule =
  | "utc_midnight"
  | "noon_anchor"
  | "east_host_midnight"
  | "west_host_midnight"
  | "ambiguous_host_offset";

export interface LegacyDay {
  /** `YYYY-MM-DD`. */
  day: string;
  rule: LegacyDayRule;
  /** True when the day is the UTC date only because nothing better could be said. */
  ambiguous: boolean;
}

const DAY_MS = 86_400_000;
const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The calendar day a legacy day column holds.
 *
 * Day columns were meant to hold UTC midnight, and most do. A few hold
 * another hour, for two known reasons:
 *
 * - **Noon on purpose** (`12:00:00.000Z` exactly): the birthday route, the
 *   cruise import and the spreadsheet round-trip write the day at UTC noon so
 *   no zone can move it. That day is the UTC date.
 * - **A host that was not on UTC**: a `new Date("2027-05-02T00:00")` parsed on
 *   a host at UTC+2 lands at `2027-05-01T22:00Z`. The hour says which side:
 *   12–23 is a host east of UTC (the day is the NEXT UTC date), 0–9 a host
 *   west of it (the same date).
 *
 * 10:00–11:59 is where the two sides meet: a host at +13/+14 (Tonga,
 * Kiritimati — next day) and one at −10/−11 (Hawaii, Samoa — same day) write
 * the same hour. That is not decided: the UTC date is kept and the value is
 * marked `ambiguous`, for the report.
 */
export function legacyDayOf(anchor: Date): LegacyDay {
  const ms = anchor.getTime();
  const intoDay = ((ms % DAY_MS) + DAY_MS) % DAY_MS;
  const hour = Math.floor(intoDay / 3_600_000);
  if (intoDay === 0) return { day: utcDate(ms), rule: "utc_midnight", ambiguous: false };
  if (intoDay === 12 * 3_600_000) {
    return { day: utcDate(ms), rule: "noon_anchor", ambiguous: false };
  }
  if (hour >= 12)
    return { day: utcDate(ms + DAY_MS), rule: "east_host_midnight", ambiguous: false };
  if (hour <= 9) return { day: utcDate(ms), rule: "west_host_midnight", ambiguous: false };
  return { day: utcDate(ms), rule: "ambiguous_host_offset", ambiguous: true };
}

export type FakeUtcReading =
  | { status: "converted"; utc: Date; offset: string; ambiguous: boolean; local: string }
  | { status: "nonexistent"; local: string };

/**
 * The instant a fake-UTC value names at a place: its UTC components read as
 * that place's wall clock. A repeated autumn hour resolves to the earlier
 * occurrence (owner decision Q5) and says `ambiguous`. A wall clock the zone
 * skipped is NOT placed anywhere — the stored reading is on no clock, and
 * where it "would" land is a guess — so it comes back `nonexistent`.
 */
export function fakeUtcToInstant(fake: Date, zone: string): FakeUtcReading {
  const local = fake.toISOString().slice(0, 19);
  try {
    const r = toInstant(local, zone, { origin: "typed" });
    return { status: "converted", utc: r.utc, offset: r.offset, ambiguous: r.ambiguous, local };
  } catch (error) {
    if (error instanceof LocalTimeNonexistentError) return { status: "nonexistent", local };
    throw error;
  }
}

/** The instant a local day begins at a place (a gap at midnight moves to the first minute that exists). */
export function startOfDayAt(day: string, zone: string): Date {
  return toInstant(`${day}T00:00`, zone, { origin: "machine" }).utc;
}

/**
 * The day a year-only or month-only placeholder names, or null when `stored`
 * is not one.
 *
 * A historical flight known only by its year (or year and month) has no
 * clock: its semantics stay `UNKNOWN` and the schema stores the placeholder
 * as midnight UTC on the 1st — 1 January for a bare year. That instant is no
 * moment anyone flew at, so no zone may move it: read at a western airport
 * it is the evening before, and 1 January 2015 was filed under 2014 by every
 * year-based flight statistic (forgejo#256).
 *
 * Only that exact shape is recognised — `UNKNOWN`, 00:00:00.000 UTC, on the
 * 1st of a month. A placeholder written through its airport's zone (the form
 * sends local midnight with the zone) already reads back on its own day
 * through that zone and is not touched; an unclassified real time keeps its
 * zone reading unless it falls on exactly that instant.
 */
export function placeholderDayOf(
  stored: Date,
  semantics: string | null | undefined
): string | null {
  if (semantics !== "UNKNOWN") return null;
  const ms = stored.getTime();
  if (ms % DAY_MS !== 0 || stored.getUTCDate() !== 1) return null;
  return utcDate(ms);
}
