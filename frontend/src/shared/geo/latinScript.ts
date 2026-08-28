/**
 * Is a stored place name readable in the alphabet this app is written in?
 *
 * Reverse geocoding used to answer in the LOCAL language of a location, so a
 * German logbook filled itself with 日光市, مصر and Հայաստան. Measured on a
 * real instance: 21 of 54 places and 15 of 284 properties. Text like that
 * cannot be read, sorted, or typed into a search box by the people using it —
 * and it silently splits one country into two entries.
 *
 * The geocoder is now asked for `de,en` (see `services/geo/nominatim.ts`), so
 * new rows arrive in Latin script. This module is what lets the backfill find
 * the rows recorded BEFORE that and fetch them again.
 *
 * MIRRORED from `backend/src/shared/geo/latinScript.ts` — same convention as
 * shared/domains.ts. Change both together.
 */

/**
 * Characters that count as readable here, by Unicode block:
 *
 *   U+0020–U+024F  Basic Latin, Latin-1 Supplement, Latin Extended-A and -B
 *   U+1E00–U+1EFF  Latin Extended Additional — Vietnamese, e.g. "Da Nang"
 *   U+2000–U+206F  General punctuation: en dashes, typographic quotes
 *   U+20A0–U+20BF  Currency symbols
 *
 * Deliberately generous about accents. The line is the SCRIPT, not the
 * language: a name in Latin letters can be looked up, typed and alphabetised
 * even by a reader who does not speak it, which is not true of another
 * alphabet. So "Lëtzebuerg", "Espanya" and "Da Nang" all pass, while Greek,
 * Cyrillic, Arabic, Armenian, Georgian and CJK do not.
 */
const NON_LATIN = /[^\u0020-\u024F\u1E00-\u1EFF\u2000-\u206F\u20A0-\u20BF]/u;

/**
 * True when the text contains at least one character outside Latin script.
 *
 * Empty and null count as fine — "nothing stored" is a different problem, and
 * the ordinary backfill already handles it.
 */
export function hasNonLatinScript(value: string | null | undefined): boolean {
  if (!value) return false;
  return NON_LATIN.test(value);
}

/** True when any of the given fields is unreadable in Latin script. */
export function anyNonLatin(...values: (string | null | undefined)[]): boolean {
  return values.some(hasNonLatinScript);
}
