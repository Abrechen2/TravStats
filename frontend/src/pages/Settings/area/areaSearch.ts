import { foldForSearch } from "../settingsSearchMatch";
import {
  isRowFindable,
  type RegistryAccess,
  type RegistryPage,
  type RegistrySection,
  type SettingsRow,
} from "../registry";
import { mountFor } from "./areaModel";

export type SearchLanguage = "de" | "en";

export interface AreaSearchHit {
  /** Unique within a result list. */
  key: string;
  pageId: string;
  sectionId: string;
  /** The row the hit names, or null when a section's title matched. */
  rowId: string | null;
  label: string;
  /** "Profil & Anmeldung › Profil", in the reader's language. */
  where: string;
  /** Only the expert level shows what this points at. */
  expertOnly: boolean;
  /** `path?query#hash`, in the canonical order. */
  href: string;
  /** The id of the mounted section to mark (`settings-<id>`). */
  highlight: string;
  rank: number;
}

export interface AreaSearchResult {
  /** Every hit, best first. */
  hits: readonly AreaSearchHit[];
}

/** Matching is the same for both languages: a German reader may type "backup". */
const pick = (de: string, en: string, lang: SearchLanguage): string => (lang === "de" ? de : en);

function sectionFindable(
  page: RegistryPage,
  section: RegistrySection,
  access: RegistryAccess
): boolean {
  if (!access.isAdmin && (page.audience === "admin" || section.audience === "admin")) return false;
  if (page.domain && !access.isDomainOn(page.domain)) return false;
  if (section.beta && !access.isGateOpen(section.beta)) return false;
  return true;
}

/** The address of a hit: the page, the row as `?match=`, the section as the hash. */
export function hitHref(
  page: RegistryPage,
  section: RegistrySection,
  row: SettingsRow | null
): string {
  const query = new URLSearchParams();
  // A service card of the catalogue opens by its id.
  if (page.id === "services") query.set("service", section.id);
  if (row) query.set("match", row.id);
  // Expert rows open for this visit without touching the saved level.
  const expert = row ? row.level === "expert" : section.level === "expert";
  if (expert) query.set("expert", "1");
  const search = query.toString();
  return `/settings/${page.id}${search ? `?${search}` : ""}#${section.id}`;
}

function rankOf(needle: string, label: string, otherLabel: string, terms: string): number | null {
  if (label.startsWith(needle)) return 0;
  if (label.includes(needle)) return 1;
  if (otherLabel.includes(needle)) return 2;
  if (terms.includes(needle)) return 3;
  return null;
}

/**
 * Finds settings by what they are called, in either language, across the whole
 * registry: every row a person can find — expert rows included, without
 * touching the saved level — and every section title (the 31 service cards are
 * mostly a title). A query under two characters finds nothing.
 */
export function searchArea(
  query: string,
  pages: readonly RegistryPage[],
  access: RegistryAccess,
  lang: SearchLanguage
): AreaSearchResult {
  const needle = foldForSearch(query);
  if (needle.length < 2) return { hits: [] };
  const hits: AreaSearchHit[] = [];
  for (const page of pages) {
    for (const section of page.sections) {
      if (!sectionFindable(page, section, access)) continue;
      const where = `${pick(page.de, page.en, lang)} › ${pick(section.de, section.en, lang)}`;
      const sectionRank = rankOf(
        needle,
        foldForSearch(pick(section.de, section.en, lang)),
        foldForSearch(pick(section.en, section.de, lang)),
        ""
      );
      const highlight = (rowId: string | null): string =>
        mountFor(page.id, section.id, rowId)?.id ?? section.id;
      if (sectionRank !== null) {
        hits.push({
          key: `${page.id}/${section.id}`,
          pageId: page.id,
          sectionId: section.id,
          rowId: null,
          label: pick(section.de, section.en, lang),
          where: pick(page.de, page.en, lang),
          expertOnly: section.level === "expert",
          href: hitHref(page, section, null),
          highlight: highlight(null),
          rank: sectionRank,
        });
      }
      for (const row of section.rows) {
        if (!isRowFindable(page, section, row, access)) continue;
        const rank = rankOf(
          needle,
          foldForSearch(pick(row.de, row.en, lang)),
          foldForSearch(pick(row.en, row.de, lang)),
          foldForSearch(`${row.terms.de} ${row.terms.en}`)
        );
        if (rank === null) continue;
        hits.push({
          key: `${page.id}/${section.id}/${row.id}`,
          pageId: page.id,
          sectionId: section.id,
          rowId: row.id,
          label: pick(row.de, row.en, lang),
          where,
          expertOnly: row.level === "expert",
          href: hitHref(page, section, row),
          highlight: highlight(row.id),
          rank,
        });
      }
    }
  }
  // Array.prototype.sort is stable: equal ranks keep the registry's order.
  return { hits: hits.sort((a, b) => a.rank - b.rank) };
}
