/**
 * The passport scoped to ONE calendar year (companion-redesign C4).
 *
 * ## What "in year Y" means here
 *
 * Exactly what the lifetime passport already means when it publishes a year:
 * `firstYear`/`lastYear` and `visitSources[].years` are read off the DAYS each
 * piece of evidence attests (`EvidenceInput.days`, else the day of `at`). Those
 * days are dated by the rule each source already follows, and nothing here
 * re-dates them:
 *
 * - a flight on its departure airport's local day (forgejo#273, `flightDay`);
 * - a train, coach or ferry end on its station's or port's clock;
 * - a place visit on the place's calendar (ADR 0002 D4, `placeVisitAt`);
 * - a port call from its arrival to its departure day, as stored;
 * - a stay from check-in to check-out, as stored;
 * - a roadtrip station on the days it attests;
 * - a location-history day on its UTC day (only ever "unconfirmed").
 *
 * A record belongs to year Y when at least one of its days falls in Y, and it
 * carries only those days into the year's fold. So a trip over New Year shows
 * in both years, and the year view can never claim a country in a year the
 * lifetime row's `visitSources` does not list.
 *
 * ## Abstention
 *
 * A record with no day — an undated flight, a place ticked without a visit
 * day, a house with no stay or with stays nobody dated, a stay whose month is a
 * placeholder, a station with no date — belongs to NO year. The lifetime view
 * keeps it (and says `hasUndatedEvidence`); the year view leaves it out rather
 * than guessing it in.
 *
 * ## Why the chain is classified on the whole account first
 *
 * Flights, trains, coaches and ferries are graded as one chain
 * (`./journeyEvidence.ts`): whether a country was VISITED depends on the leg in
 * and the leg out. Filtering the legs to a year first would cut every trip that
 * spans New Year in two and turn its destination into an "open chain" in both
 * years. So the chain is read on every leg, and its graded evidence is then
 * scoped by day like every other source (`scopeEvidenceInputs`).
 */

import {
  daysBetween,
  lodgingEvidence,
  type CountableStay,
  type EvidenceInput,
} from "../../shared/countryEvidence";
import { dayCarrier } from "./journeyEvidence";
import { isoDayOf } from "./flightEvidence";
import type { CountryOverrideInput } from "./countryOverrides";
import type { Passport } from "./passport";
import { summarizePassport } from "./passportSummary";

/** Is this `YYYY-MM-DD` in the year? An absent day is in no year. */
export const dayInYear = (day: string | null | undefined, year: number): boolean =>
  typeof day === "string" && Number(day.slice(0, 4)) === year;

/** Any of these days in the year. */
export const anyDayInYear = (days: readonly string[], year: number): boolean =>
  days.some((day) => dayInYear(day, year));

/** The days a port call attests: arrival through departure, as stored. Empty when undated. */
export function portCallDays(call: { at: Date | null; until?: Date | null }): string[] {
  const from = isoDayOf(call.at);
  const to = isoDayOf(call.until);
  return from ? (to ? daysBetween(from, to) : [from]) : [];
}

/** The days an evidence input attests — the same reading the fold and `visitSources` make. */
const evidenceDays = (input: EvidenceInput): readonly string[] =>
  input.days ?? (input.at ? [input.at.toISOString().slice(0, 10)] : []);

/**
 * Every input that attests a day in the year, carrying only those days. An
 * input with no day is dropped (see the header). `at` moves to the first
 * in-year day so the fold's first/last date cannot leave the year.
 */
export function scopeEvidenceInputs<T extends EvidenceInput>(
  inputs: readonly T[],
  year: number
): T[] {
  return inputs.flatMap((input) => {
    const days = evidenceDays(input)
      .filter((day) => dayInYear(day, year))
      .sort();
    return days.length === 0 ? [] : [{ ...input, at: dayCarrier(days[0]), days }];
  });
}

/**
 * Houses with only the stays that attest a day in the year, and no house
 * without one.
 *
 * Stay by stay, through `lodgingEvidence` — the one home of "does this stay
 * count" — so a cancelled stay, a booking still ahead and a stay whose dates
 * are placeholders attest no day and drop out. A house left with NO stay is
 * dropped too rather than handed on: an empty stay list means "slept here, date
 * forgotten" and would count as an undated night in a year it has nothing to
 * do with.
 */
export function scopeLodgingStays<S extends CountableStay, L extends { stays: readonly S[] }>(
  lodgings: readonly L[],
  year: number,
  now: Date
): L[] {
  return lodgings.flatMap((lodging) => {
    const stays = lodging.stays.filter((stay) =>
      anyDayInYear(lodgingEvidence([stay], now)?.days ?? [], year)
    );
    return stays.length === 0 ? [] : [{ ...lodging, stays }];
  });
}

/**
 * The user's verdicts (forgejo#308) as they apply to one year.
 *
 * `excluded` always applies: the user said the country is wrong, in every
 * year. A `visited`/`ground` verdict applies to a country the year already
 * shows; it may only CREATE a row when the user dated it inside the year — an
 * undated verdict proves no year, the same abstention as an undated record.
 */
export function scopeOverrides(
  overrides: readonly CountryOverrideInput[],
  year: number,
  codesInYear: ReadonlySet<string>
): CountryOverrideInput[] {
  return overrides.filter(
    (o) =>
      o.verdict === "excluded" ||
      codesInYear.has(o.countryCode.toUpperCase()) ||
      dayInYear(o.day, year)
  );
}

/**
 * Every row's span is the year itself, and the totals are counted again.
 *
 * Every row of a year view stands on evidence inside that year by
 * construction; only a verdict's own day (`spanWith` in `./countryOverrides.ts`)
 * could widen it past the year, and a year answer must not carry another year.
 */
export function clampPassportToYear(passport: Passport, year: number): Passport {
  const countries = passport.countries.map((row) => ({
    ...row,
    firstYear: row.firstYear === null ? null : year,
    lastYear: row.lastYear === null ? null : year,
  }));
  const { summary, continents } = summarizePassport(countries, passport.stamps.length);
  return { ...passport, summary, countries, continents };
}
