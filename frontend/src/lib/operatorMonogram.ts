/**
 * The letters an operator or provider tile shows when there is no logo
 * (forgejo#197). There is no logo source for rail operators or rental
 * companies yet — which source to use is an open owner question — so every
 * tile is a monogram for now, and the rule for it lives here.
 *
 * The rule, in order:
 *  1. A leading acronym is kept as written: "DB Fernverkehr" → "DB",
 *     "SBB" → "SBB", "ÖBB Nightjet" → "ÖBB". An acronym is 2–4 letters, all
 *     upper case; four is what still fits a 44px tile at 12px.
 *  2. Otherwise the initials of the first two words: "Share Now" → "SN",
 *     "Deutsche Bahn" → "DB".
 *  3. One word: its first two letters, "Sixt" → "SI".
 *
 * Null for a missing or blank name — the tile then draws the domain's icon,
 * because two invented letters would read as an operator nobody recorded.
 */
const ACRONYM = /^\p{Lu}[\p{Lu}\d]{1,3}$/u;

export function operatorMonogram(name: string | null | undefined): string | null {
  const words = (name ?? "")
    .split(/[\s\-–/·,&+]+/u)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word !== "");
  if (words.length === 0) return null;
  const [first, second] = words;
  if (ACRONYM.test(first)) return first;
  if (second !== undefined) return `${first[0]}${second[0]}`.toLocaleUpperCase();
  return first.slice(0, 2).toLocaleUpperCase();
}
