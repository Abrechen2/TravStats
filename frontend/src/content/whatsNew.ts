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
  /** A single emoji glyph, rendered as text. Same convention as `shared/domains.ts`. */
  icon: string;
  /** dotted key inside the `whatsNew` i18n namespace */
  titleKey: string;
  bodyKey: string;
}

export interface WhatsNewEntry {
  /**
   * The release the highlights describe. Matched against the backend
   * `appVersion` with `<=`, never `===` — see `findEntryForVersion`.
   */
  version: string;
  /** 1-5 items. More than five is a changelog, not a modal. */
  highlights: WhatsNewItem[];
}

export const WHATS_NEW_ENTRIES: WhatsNewEntry[] = [
  {
    version: "2.6.0",
    highlights: [
      {
        icon: "🏨",
        titleKey: "entries.v260.lodging.title",
        bodyKey: "entries.v260.lodging.body",
      },
      {
        icon: "✉️",
        titleKey: "entries.v260.parser.title",
        bodyKey: "entries.v260.parser.body",
      },
      {
        icon: "💱",
        titleKey: "entries.v260.currency.title",
        bodyKey: "entries.v260.currency.body",
      },
      {
        icon: "🔐",
        titleKey: "entries.v260.security.title",
        bodyKey: "entries.v260.security.body",
      },
      {
        icon: "🗺️",
        titleKey: "entries.v260.map.title",
        bodyKey: "entries.v260.map.body",
      },
    ],
  },
  {
    version: "2.5.0",
    highlights: [
      {
        icon: "🛫",
        titleKey: "entries.v250.flightsTable.title",
        bodyKey: "entries.v250.flightsTable.body",
      },
      {
        icon: "📸",
        titleKey: "entries.v250.immich.title",
        bodyKey: "entries.v250.immich.body",
      },
      {
        icon: "👥",
        titleKey: "entries.v250.companions.title",
        bodyKey: "entries.v250.companions.body",
      },
      {
        icon: "⏱️",
        titleKey: "entries.v250.flightForm.title",
        bodyKey: "entries.v250.flightForm.body",
      },
      {
        icon: "🔄",
        titleKey: "entries.v250.status.title",
        bodyKey: "entries.v250.status.body",
      },
    ],
  },
  {
    version: "2.4.0",
    highlights: [
      {
        icon: "🎨",
        titleKey: "entries.v240.colorModes.title",
        bodyKey: "entries.v240.colorModes.body",
      },
      {
        icon: "✈️",
        titleKey: "entries.v240.airlines.title",
        bodyKey: "entries.v240.airlines.body",
      },
      {
        icon: "🗺️",
        titleKey: "entries.v240.map.title",
        bodyKey: "entries.v240.map.body",
      },
      {
        icon: "🐛",
        titleKey: "entries.v240.fixes.title",
        bodyKey: "entries.v240.fixes.body",
      },
      {
        icon: "🧹",
        titleKey: "entries.v240.polish.title",
        bodyKey: "entries.v240.polish.body",
      },
    ],
  },
  {
    version: "2.3.0",
    highlights: [
      {
        icon: "📊",
        titleKey: "entries.v230.stats.title",
        bodyKey: "entries.v230.stats.body",
      },
      {
        icon: "✨",
        titleKey: "entries.v230.whatsNew.title",
        bodyKey: "entries.v230.whatsNew.body",
      },
    ],
  },
];

/** Numeric semver compare. Any prerelease suffix (`-rc.5`) is ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    v
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The newest entry that is not in the future relative to the running version.
 *
 * Deliberately NOT an exact match. An exact match silently breaks whenever the
 * shipping version differs from the one the entry was authored against — which
 * is exactly what happened in 2.3.0: the entry was keyed `2.4.0` while the
 * feature was planned for 2.4.0, then shipped in 2.3.0, so the modal never
 * fired in production. With `<=`, a 2.3.0 entry still reaches someone running
 * 2.3.1, and someone jumping 2.2.2 → 2.3.5 sees it too.
 *
 * Callers must record dismissal against the returned `entry.version`, not
 * against the running version, or the modal reappears on every patch.
 */
export function findEntryForVersion(version: string): WhatsNewEntry | undefined {
  return WHATS_NEW_ENTRIES.filter((entry) => compareVersions(entry.version, version) <= 0).sort(
    (a, b) => compareVersions(b.version, a.version)
  )[0];
}
