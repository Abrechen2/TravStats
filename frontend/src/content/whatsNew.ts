/**
 * Hand-authored release highlights, shown once per version by WhatsNewModal.
 *
 * Deliberately not parsed from CHANGELOG.md: the changelog is English-only and
 * developer-facing, while this copy is DE-primary and user-facing.
 *
 * Adding an entry is part of the release routine. A missing entry is not an
 * error — the modal simply does not show.
 */

export interface WhatsNewItem {
  /** lucide-react icon name */
  icon: string;
  /** dotted key inside the `whatsNew` i18n namespace */
  titleKey: string;
  bodyKey: string;
}

export interface WhatsNewEntry {
  /** Exact match against the backend `appVersion` (prerelease suffix stripped). */
  version: string;
  /** 1-5 items. More than five is a changelog, not a modal. */
  highlights: WhatsNewItem[];
}

export const WHATS_NEW_ENTRIES: WhatsNewEntry[] = [
  {
    version: "2.4.0",
    highlights: [
      {
        icon: "BarChart3",
        titleKey: "entries.v240.stats.title",
        bodyKey: "entries.v240.stats.body",
      },
      {
        icon: "Sparkles",
        titleKey: "entries.v240.whatsNew.title",
        bodyKey: "entries.v240.whatsNew.body",
      },
    ],
  },
];

export function findEntryForVersion(version: string): WhatsNewEntry | undefined {
  return WHATS_NEW_ENTRIES.find((entry) => entry.version === version);
}
