import { hasNonLatinScript } from "../../shared/geo/latinScript";
import type { PlaceResult } from "./photon";

/**
 * Two names per place hit: one the traveller can read, and the one on the sign.
 *
 * Photon localises `name` per request. Asked in German about Seoul it answers
 * Hangul, because `name:de` is rare there and Photon falls back to the default
 * name — the owner's "Ort jetzt" list from Seoul (2026-10-04) offered Korean
 * names only (forgejo#199). A name in a script the reader cannot read cannot be
 * recognised, typed into a search, or sorted (`shared/geo/latinScript.ts`).
 *
 * So when a hit comes back in a non-Latin script, the same lookup is repeated
 * in English (`name:en`, else Photon's default) and with `lang=default` (the
 * name in the place's own script), and the answers are matched by OSM identity:
 *
 *   name       the requested language if Latin, else English if Latin, else
 *              the name as it came (abstention: no transliteration is invented)
 *   localName  the default-script name, only where it differs from `name`
 */

/**
 * Non-Latin by SCRIPT, for any script — Cyrillic, Greek, Arabic, Hebrew, Thai,
 * Devanagari, Georgian, Armenian, Hangul, Kana, Han (owner, 2026-10-04: "das
 * muss mit allen Länder Schriften gehen"). Two things that are not another
 * script are taken out first, because `latinScript.ts` alone reads them as
 * one: accents sent decomposed ("Hà Nội" in NFD carries U+0300–U+036F),
 * letterlike signs such as "№" (U+2100–U+214F), and the spacing modifier
 * letters U+02B0–U+02FF — the Hawaiian ʻokina in "Hawaiʻi-Volcanoes-
 * Nationalpark" made the backfill treat a German name as foreign script
 * (measured on the RC and prod, 2026-10-04; it found no match, but a match
 * would have swapped the German name for the English one).
 */
export function isNonLatin(name: string): boolean {
  return hasNonLatinScript(name.normalize("NFC").replace(/[\u02B0-\u036F\u2100-\u214F]/gu, ""));
}

/**
 * Countries whose signs are written in a script other than Latin. A hit there
 * may come back with a Latin name already (`name:de` or `name:en` exists — "Seoul
 * Station"), and the name on the sign is then only found by asking for it, so
 * these trigger the extra lookups too. Elsewhere a Latin hit IS the sign, and
 * asking again would double every lookup for nothing. Lowercase ISO 3166-1,
 * the form Photon sends in `countrycode`.
 */
const NON_LATIN_SCRIPT_COUNTRIES = new Set([
  // Cyrillic
  "ru",
  "by",
  "ua",
  "bg",
  "rs",
  "mk",
  "me",
  "ba",
  "kz",
  "kg",
  "tj",
  "mn",
  // Greek
  "gr",
  "cy",
  // Hebrew, Arabic, Persian, Urdu, Pashto
  "il",
  "ps",
  "ae",
  "sa",
  "eg",
  "jo",
  "lb",
  "sy",
  "iq",
  "kw",
  "qa",
  "bh",
  "om",
  "ye",
  "ly",
  "dz",
  "ma",
  "tn",
  "sd",
  "mr",
  "ir",
  "af",
  "pk",
  // Caucasus
  "ge",
  "am",
  // South Asia: Devanagari, Bengali, Sinhala, Tibetan, Thaana
  "in",
  "np",
  "bd",
  "lk",
  "bt",
  "mv",
  // South-East Asia: Thai, Lao, Khmer, Burmese
  "th",
  "la",
  "kh",
  "mm",
  // East Asia: Han, Kana, Hangul
  "cn",
  "tw",
  "hk",
  "mo",
  "jp",
  "kr",
  "kp",
  // Ge'ez
  "et",
  "er",
]);

/** Only when this is true are the extra lookups worth their round trips. */
export function needsLatinNames(results: readonly PlaceResult[]): boolean {
  return results.some(
    (r) =>
      isNonLatin(r.name) ||
      (r.countryCode !== undefined && NON_LATIN_SCRIPT_COUNTRIES.has(r.countryCode.toLowerCase()))
  );
}

const byRef = (results: readonly PlaceResult[] | null): Map<string, string> =>
  new Map(
    (results ?? [])
      .filter((r): r is PlaceResult & { externalRef: string } => Boolean(r.externalRef))
      .map((r) => [r.externalRef, r.name])
  );

/**
 * Merge the requested-language hits with the English and default-name answers.
 * Either extra answer may be null (the lookup failed): a hit then keeps what it
 * has rather than losing its name. A hit without an OSM identity cannot be
 * matched and stays as it came.
 */
export function mergePlaceNames(
  requested: readonly PlaceResult[],
  english: readonly PlaceResult[] | null,
  local: readonly PlaceResult[] | null
): PlaceResult[] {
  const englishByRef = byRef(english);
  const localByRef = byRef(local);
  return requested.map((hit) => {
    if (!hit.externalRef) return hit;
    const englishName = englishByRef.get(hit.externalRef);
    const name =
      !isNonLatin(hit.name) || !englishName || isNonLatin(englishName) ? hit.name : englishName;
    // Without a default-name answer, the name we replaced IS the local one.
    const localCandidate =
      localByRef.get(hit.externalRef) ?? (name !== hit.name ? hit.name : undefined);
    const localName = localCandidate && localCandidate !== name ? localCandidate : undefined;
    return { ...hit, name, ...(localName ? { localName } : {}) };
  });
}
