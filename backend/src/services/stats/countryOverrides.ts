/**
 * The user's own verdict on a passport country (forgejo#308), applied once,
 * after the automatic fold.
 *
 * The passport counts what the records prove, and records are incomplete or
 * wrong: a visit nobody logged, a hotel geocoded into the wrong country, a
 * chain the records cannot decide. Until now the only answer was "unclear".
 * An override is the user saying what is true, with a note saying why:
 *
 * - `visited`  — the country is in both sets. An existing row is lifted to a
 *   visit (a `slept` tier stays `slept`); a country with no row gets one.
 * - `ground`   — on the ground, not a visit. A visited row is demoted to
 *   `transited`; a country with no row gets a ground-only one.
 * - `excluded` — the country leaves both sets and every total, and is listed
 *   in `excludedCountries` so it can be undone. Never silently deleted.
 *
 * Applied here and only here — inside `loadPassport` and the country
 * drill-down — so every figure built on the passport (headline, hero, badges,
 * wrapped, comparison, federation) gives the same answer. The totals are then
 * counted again by `summarizePassport`, the same code the fold uses.
 *
 * A manual row proves no day: it adds nothing to `daysPresent`, and a row it
 * creates is undated unless the user gave a day. The day is the user's own,
 * never invented, and only ever moves a year.
 */

import { continentForCountry } from "../../utils/continents";
import type { CountryTier, EvidenceKind } from "../../shared/countryEvidence";
import type { Passport, PassportCountry } from "./passport";
import { compareCountryRows, summarizePassport } from "./passportSummary";

export const COUNTRY_OVERRIDE_VERDICTS = ["visited", "ground", "excluded"] as const;
export type CountryOverrideVerdict = (typeof COUNTRY_OVERRIDE_VERDICTS)[number];

/** What a passport row says about the user's verdict on it. */
export interface CountryOverrideView {
  verdict: CountryOverrideVerdict;
  note: string;
  /** `YYYY-MM-DD`, a day the user remembers; null when none was given. */
  day: string | null;
}

/** A country the user took out of the passport, kept visible so it can be undone. */
export interface ExcludedCountry {
  code: string;
  note: string;
  day: string | null;
}

/** One override as the store hands it over. */
export interface CountryOverrideInput extends CountryOverrideView {
  /** ISO 3166-1 alpha-2, upper case. */
  countryCode: string;
}

const TIER_RANK: Record<CountryTier, number> = {
  slept: 3,
  visited: 2,
  transited: 1,
  connection: 0,
};

const withManual = (kinds: readonly EvidenceKind[]): EvidenceKind[] =>
  kinds.includes("manual") ? [...kinds] : [...kinds, "manual" as const].sort();

const yearOf = (day: string | null): number | null => (day ? Number(day.slice(0, 4)) : null);

/** Widen a row's period by the user's day, if one was given. */
function spanWith(
  row: Pick<PassportCountry, "firstYear" | "lastYear">,
  day: string | null
): { firstYear: number | null; lastYear: number | null } {
  const year = yearOf(day);
  if (year === null) return { firstYear: row.firstYear, lastYear: row.lastYear };
  return {
    firstYear: row.firstYear === null ? year : Math.min(row.firstYear, year),
    lastYear: row.lastYear === null ? year : Math.max(row.lastYear, year),
  };
}

/** A row for a country no record put in the passport. */
function manualRow(override: CountryOverrideInput): PassportCountry {
  const year = yearOf(override.day);
  return {
    code: override.countryCode,
    // From the code alone, which answers null for a transcontinental country
    // rather than guessing a side.
    continent: continentForCountry(override.countryCode),
    entries: 0,
    firstYear: year,
    firstVisitedYear: null,
    lastYear: year,
    airports: [],
    isHome: false,
    isNew: false,
    evidence: "manual",
    tier: "transited",
    kinds: ["manual"],
    hasUndatedEvidence: override.day === null,
    daysPresent: 0,
    groundTime: { state: "notApplicable" },
    counted: false,
    groundPresence: true,
    visited: false,
    visitUncertain: false,
    visitUncertainReasons: [],
    visitSources: [],
    portCalls: 0,
    places: 0,
    lodging: null,
    override: null,
  };
}

function applyOne(
  row: PassportCountry,
  override: CountryOverrideInput,
  thisYear: number
): PassportCountry {
  const view: CountryOverrideView = {
    verdict: override.verdict,
    note: override.note,
    day: override.day,
  };
  const common = {
    ...row,
    ...spanWith(row, override.day),
    kinds: withManual(row.kinds),
    visitUncertain: false,
    visitUncertainReasons: [],
    override: view,
  };
  if (override.verdict === "visited") {
    const firstVisitedYear = row.firstVisitedYear ?? yearOf(override.day);
    return {
      ...common,
      tier: TIER_RANK[row.tier] >= TIER_RANK.visited ? row.tier : "visited",
      counted: true,
      visited: true,
      firstVisitedYear,
      isNew: firstVisitedYear === thisYear,
    };
  }
  // `ground`: present, not visited — capped at `transited`, never raised.
  return {
    ...common,
    tier: TIER_RANK[row.tier] > TIER_RANK.transited ? "transited" : row.tier,
    counted: false,
    visited: false,
    visitSources: [],
    firstVisitedYear: null,
    isNew: false,
  };
}

/**
 * The passport with the user's overrides applied and every total recounted.
 * Pure: the caller reads the overrides and the user's current year.
 */
export function applyCountryOverrides(
  passport: Passport,
  overrides: readonly CountryOverrideInput[],
  thisYear: number
): Passport {
  if (overrides.length === 0) return passport;
  const byCode = new Map(overrides.map((o) => [o.countryCode.toUpperCase(), o]));
  const excluded = new Set(
    overrides.filter((o) => o.verdict === "excluded").map((o) => o.countryCode.toUpperCase())
  );

  const known = new Set(passport.countries.map((row) => row.code));
  const rows = [
    ...passport.countries,
    ...overrides
      .filter((o) => o.verdict !== "excluded" && !known.has(o.countryCode.toUpperCase()))
      .map((o) => manualRow({ ...o, countryCode: o.countryCode.toUpperCase() })),
  ];

  const countries = rows
    .filter((row) => !excluded.has(row.code))
    .map((row) => {
      const override = byCode.get(row.code);
      return override ? applyOne(row, override, thisYear) : row;
    })
    .sort(compareCountryRows);

  // An excluded country's airports leave the stamp book too: "every total".
  const stamps = passport.stamps.filter((s) => !s.country || !excluded.has(s.country));
  const { summary, continents } = summarizePassport(countries, stamps.length);

  return {
    ...passport,
    summary,
    countries,
    continents,
    stamps,
    excludedCountries: overrides
      .filter((o) => o.verdict === "excluded")
      .map((o) => ({ code: o.countryCode.toUpperCase(), note: o.note, day: o.day }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}
