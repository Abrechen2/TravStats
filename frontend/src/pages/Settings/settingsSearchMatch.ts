/**
 * Finding a setting by what it is called, not by which page it lives on.
 *
 * Owner request 2026-09-24. The settings are a dozen pages and some thirty
 * sections, and the thing a person looks for is often a word INSIDE a section
 * — "Passwort", "Immich", "km" — that no section title carries. So each
 * section is searched under its title and under a list of keywords
 * (`settings:search.keywords.<section>`, DE and EN like every other string).
 */

export interface SettingsSearchCandidate {
  /** The section's id, unique within its page. */
  section: string;
  /** The section's title, as its heading and chip show it. */
  label: string;
  /** The page it lives on, to say where the hit is. */
  groupLabel: string;
  /** Where to go: `/settings/<page>?section=<section>` or the admin equivalent. */
  href: string;
  keywords: readonly string[];
  /**
   * Words for rows the standard level hides inside an otherwise standard
   * section — the polling window of flight updates, an own API key. A hit on
   * one of these is an expert hit although its section is not.
   */
  expertKeywords?: readonly string[];
  /** The whole section is expert-only. */
  expert?: boolean;
}

export interface SettingsSearchHit extends SettingsSearchCandidate {
  /** The keyword that matched, or null when the title itself did. */
  matchedKeyword: string | null;
  /** Only the expert level shows what this hit points at (forgejo#321). */
  expertOnly: boolean;
}

/** Case, accents and ß folded away: "Wahrung" finds "Währung", "strasse" finds "Straße". */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").toLowerCase().trim();
}

/** The keyword list of one section, as the translation writes it: comma-separated. */
export function splitKeywords(raw: string): string[] {
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/**
 * The sections a query finds, best first: a title that starts with the query,
 * then a title that contains it, then a keyword that starts with it, then a
 * keyword that contains it. A query under two characters finds nothing — one
 * letter matches half the settings and helps nobody.
 */
export function searchSettings(
  query: string,
  candidates: readonly SettingsSearchCandidate[]
): SettingsSearchHit[] {
  const needle = foldForSearch(query);
  if (needle.length < 2) return [];

  const ranked: Array<{ hit: SettingsSearchHit; rank: number }> = [];
  for (const candidate of candidates) {
    const sectionExpert = candidate.expert === true;
    const title = foldForSearch(candidate.label);
    if (title.includes(needle)) {
      ranked.push({
        hit: { ...candidate, matchedKeyword: null, expertOnly: sectionExpert },
        rank: title.startsWith(needle) ? 0 : 1,
      });
      continue;
    }
    // A word that reaches a row only the expert level draws makes the hit an
    // expert one, even when an ordinary word matched too: "AirLabs" is a
    // provider row at standard and a key form at expert, and the reader typing
    // it may well want the key.
    const keyword = matchKeyword(needle, candidate.keywords);
    const expertKeyword = matchKeyword(needle, candidate.expertKeywords ?? []);
    const found = expertKeyword ?? keyword;
    if (found) {
      const starts = Boolean(keyword?.starts || expertKeyword?.starts);
      ranked.push({
        hit: {
          ...candidate,
          matchedKeyword: found.raw,
          expertOnly: sectionExpert || expertKeyword !== null,
        },
        rank: starts ? 2 : 3,
      });
    }
  }
  return ranked.sort((a, b) => a.rank - b.rank).map((r) => r.hit);
}

/** The keyword a needle finds — one it starts, else one it is inside of. */
function matchKeyword(
  needle: string,
  keywords: readonly string[]
): { raw: string; starts: boolean } | null {
  const folded = keywords.map((k) => ({ raw: k, folded: foldForSearch(k) }));
  const starts = folded.find((k) => k.folded.startsWith(needle));
  if (starts) return { raw: starts.raw, starts: true };
  const contains = folded.find((k) => k.folded.includes(needle));
  return contains ? { raw: contains.raw, starts: false } : null;
}
