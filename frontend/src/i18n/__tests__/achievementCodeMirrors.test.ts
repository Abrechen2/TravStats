import { describe, it, expect } from "vitest";

import de from "../resources/de/achievements.json";
import en from "../resources/en/achievements.json";

/**
 * Every achievement gets an English name, or it silently ships in German.
 *
 * The seeds carry German copy — that is the language policy for user-facing
 * text — and the achievements page prefers `codes.<CODE>` from this file when
 * one exists. When it does not, there is no error and no blank: the German name
 * simply appears in an English UI, which is the kind of gap nobody reports
 * because it still looks like a working page.
 *
 * The catalogue lives in the backend and this is the frontend, so the codes are
 * listed here rather than imported across the boundary. That makes this a COPY,
 * and the copy can only be defended in one direction: a badge listed here with
 * no mirror fails. A badge added to the backend and never listed here cannot be
 * caught from this side at all — which is why the list carries the instruction
 * to extend it in the same change, rather than pretending to be a full check.
 */

/**
 * Achievement codes, as at 2026-08-29. Add the code here in the same change
 * that adds the badge; the second assertion below is what makes forgetting it
 * a failing test rather than a German word in an English list.
 */
const POI_CODES_PART_H = [
  "PLACE_CITIES_5",
  "PLACE_CITIES_20",
  "PLACE_CITIES_50",
  "PLACE_CONTINENTS_3",
  "PLACE_CONTINENTS_5",
  "PLACE_CONTINENTS_7",
  "PLACE_CATEGORIES_4",
  "PLACE_CATEGORIES_ALL",
  "PLACE_REGULAR_5",
  "PLACE_REGULAR_15",
  "PLACES_ONE_DAY_5",
  "PLACES_ONE_DAY_10",
  "PLACE_STREAK_7",
  "PLACE_STREAK_14",
  "PLACE_YEAR_25",
  "PLACE_YEAR_100",
  "PLACE_COUNTRIES_YEAR_5",
  "PLACE_RATED_10",
  "PLACE_RATED_50",
  "PLACE_TRIP_10",
  "PLACE_TRIP_50",
  "PLACE_NORTH_60",
  "PLACE_NORTH_66",
  "PLACE_SOUTH_35",
  "PLACE_SOUTH_54",
] as const;

type Entry = { name?: string; description?: string };
const codes = en.codes as Record<string, Entry>;
const germanCodes = de.codes as Record<string, Entry>;

describe("English achievement mirrors", () => {
  it("gives every Part H badge an English name and description", () => {
    const missing = POI_CODES_PART_H.filter(
      (code) => !codes[code]?.name || !codes[code]?.description
    );
    expect(missing).toEqual([]);
  });

  it("leaves no mirror carrying German copy by accident", () => {
    // A mirror that is character-for-character the German seed name is a
    // forgotten translation wearing a translation's clothes. These are the
    // words that would give it away.
    const germanTells = /\b(und|der|die|das|besucht|Orte|Länder|Jahr|Tagen|Kontinente)\b/;
    const suspicious = POI_CODES_PART_H.filter((code) =>
      germanTells.test(`${codes[code]?.name ?? ""} ${codes[code]?.description ?? ""}`)
    );
    expect(suspicious).toEqual([]);
  });

  /**
   * The direction this file was missing until 2026-08-30, and the reason all 25
   * Part H badges shipped reading "City stroller" on a German page.
   *
   * German is the PRIMARY locale. The page asks for `codes.<CODE>` with the
   * seeded German name as `defaultValue`, which looks like a safe fallback and
   * is not: i18next falls back to `en` BEFORE it reaches `defaultValue`, so a
   * key present in English and absent in German resolves to the English string
   * and the default never runs. Nothing errors, nothing is blank — the badge
   * simply speaks the wrong language.
   *
   * Both files are in the frontend, so unlike the mirror check above this one
   * needs no hand-maintained list and cannot rot: every English key must have a
   * German one, whatever gets added later.
   */
  it("gives every English mirror a German one, so the fallback never wins", () => {
    const missing = Object.keys(codes).filter((code) => !germanCodes[code]?.name);
    expect(missing).toEqual([]);
  });

});
