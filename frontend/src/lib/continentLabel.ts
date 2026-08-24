/**
 * Localised name for a continent the SERVER resolved.
 *
 * The server answers in its own vocabulary ("North America"), because the
 * careful resolution — transcontinental splits, coordinate fallback — lives
 * there and mirroring it would mean two implementations that can disagree.
 * That leaves exactly one thing for the client: a label.
 *
 * The keys live in `common:continents` rather than borrowing
 * `stats:airportStats.continent`, which looks like the same seven words and is
 * not: that block belongs to one chart, carries an "other" bucket instead of
 * Antarctica, and reaching into it from the POI domain would couple two
 * features that have no reason to move together.
 */
export function continentI18nKey(continent: string): string {
  const camel = continent.charAt(0).toLowerCase() + continent.slice(1).replace(/\s+/g, "");
  return `common:continents.${camel}`;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The label, or a dash. A place whose continent could not be resolved is rare
 * but real — an unrecognised country with coordinates in the middle of an
 * ocean — and it sorts to the end rather than pretending to be somewhere.
 */
export function continentLabel(
  continent: string | null | undefined,
  t: Translate,
  fallback = "—"
): string {
  if (!continent) return fallback;
  const label = t(continentI18nKey(continent));
  // i18next echoes the key back when it has no translation, and a raw
  // "common:continents.foo" on screen is worse than the server's own word.
  return label.startsWith("common:") ? continent : label;
}
