import { isNonLatin } from "./placeNames";

/**
 * One stored string that is really two names: "Banpo Bridge Moonlight Rainbow
 * Fountain 반포대교 달빛무지개분수" — the English name with the sign's name
 * glued on behind it. Measured on prod (forgejo#199): the Companion's "Ort
 * jetzt" flow saved it that way before places had a second name column.
 *
 * The shape that is split, and only that one:
 *
 *   <Latin prefix with at least one letter> <trailing run with no Latin letter>
 *
 * where the trailing run carries at least one letter of another script. What
 * is NOT split, because it is not two names:
 *
 *   - "Café № 5", "Hotel ★★★" — a symbol or a number is not a second name;
 *   - "Hà Nội" (also decomposed) — Latin with accents is Latin;
 *   - "반포대교" — one name, in one script, with nothing to split off;
 *   - "Gangnam 강남 Station" — the other script is not at the end, so where
 *     one name stops is a guess.
 *
 * Separators between the two halves ("-", "/", "|", "·", ":", ",") and one pair
 * of brackets around the trailing run are dropped: "Seoul Station (서울역)".
 */

export interface SplitName {
  name: string;
  localName: string;
}

const LATIN_LETTER = /\p{Script=Latin}/u;
const ANY_LETTER = /\p{L}/u;
const TRAILING_SEPARATORS = /[\s\-–—/|·:,]+$/u;
const BRACKETS: ReadonlyArray<[string, string]> = [
  ["(", ")"],
  ["[", "]"],
  ["（", "）"],
  ["「", "」"],
];

/** A word that holds no Latin letter but at least one letter of another script. */
const isForeignWord = (word: string): boolean =>
  !LATIN_LETTER.test(word) && ANY_LETTER.test(word) && isNonLatin(word);

/** Digits, punctuation, symbols — a word that belongs to neither half by itself. */
const isNeutralWord = (word: string): boolean => !ANY_LETTER.test(word);

function unwrap(run: string): string {
  for (const [open, close] of BRACKETS) {
    const inner = run.slice(open.length, run.length - close.length);
    if (run.startsWith(open) && run.endsWith(close) && !inner.includes(open)) return inner.trim();
  }
  return run;
}

/** Split a glued "<Latin> <other script>" name, or null when it is not one. */
export function splitGluedName(raw: string): SplitName | null {
  const words = raw.normalize("NFC").trim().split(/\s+/u).filter(Boolean);
  let start = words.length;
  while (start > 0 && (isForeignWord(words[start - 1]) || isNeutralWord(words[start - 1]))) {
    start -= 1;
  }
  // A run may END on a number ("서울역 2"), but it must START on a foreign word.
  while (start < words.length && !isForeignWord(words[start])) start += 1;
  if (start === 0 || start === words.length) return null;

  const prefix = words.slice(0, start).join(" ").replace(TRAILING_SEPARATORS, "");
  if (!LATIN_LETTER.test(prefix) || isNonLatin(prefix)) return null;
  const localName = unwrap(words.slice(start).join(" "));
  if (!localName || !ANY_LETTER.test(localName)) return null;
  return { name: prefix, localName };
}

/**
 * What a write stores for a name: split when it is glued AND no second name
 * was given. A given `localName` wins — the writer said what the second name
 * is, and re-reading the first one would second-guess it.
 */
export function normaliseNamePair(
  name: string,
  localName: string | null | undefined
): { name: string; localName: string | null } {
  const given = localName?.trim() || null;
  if (given) return { name, localName: given === name ? null : given };
  const split = splitGluedName(name);
  return split ?? { name, localName: null };
}
