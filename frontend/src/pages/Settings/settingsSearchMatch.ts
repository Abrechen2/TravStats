import type { SettingsSectionId } from "./settingsModel";

/**
 * Finding a setting by what it is called, not by which page it lives on.
 *
 * Owner request 2026-09-24. The settings are four routes and some twenty
 * sections, and the thing a person looks for is often a word INSIDE a section
 * — "Passwort", "Immich", "km" — that no section title carries. So each
 * section is searched under its title and under a list of keywords
 * (`settings:search.keywords.<section>`, DE and EN like every other string).
 */

export interface SettingsSearchCandidate {
  section: SettingsSectionId;
  /** The section's title, as the index lists it. */
  label: string;
  /** The page it lives on, to say where the hit is. */
  groupLabel: string;
  /** Where to go: `/settings/<route>?section=<section>`. */
  route: string;
  keywords: readonly string[];
}

export interface SettingsSearchHit extends SettingsSearchCandidate {
  /** The keyword that matched, or null when the title itself did. */
  matchedKeyword: string | null;
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
    const title = foldForSearch(candidate.label);
    if (title.startsWith(needle) || title.includes(needle)) {
      ranked.push({
        hit: { ...candidate, matchedKeyword: null },
        rank: title.startsWith(needle) ? 0 : 1,
      });
      continue;
    }
    const folded = candidate.keywords.map((k) => ({ raw: k, folded: foldForSearch(k) }));
    const starts = folded.find((k) => k.folded.startsWith(needle));
    const contains = starts ?? folded.find((k) => k.folded.includes(needle));
    if (contains) {
      ranked.push({
        hit: { ...candidate, matchedKeyword: contains.raw },
        rank: starts ? 2 : 3,
      });
    }
  }
  return ranked.sort((a, b) => a.rank - b.rank).map((r) => r.hit);
}
