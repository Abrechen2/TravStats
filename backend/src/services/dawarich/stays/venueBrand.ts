/** The brand facts of an OSM element, as smart lists read them (`travtrack/visits/brandMatch.ts`). */
export type VenueBrand = {
  wikidata: string | null;
  name: string | null;
  disused: boolean;
};

const QID = /^Q[1-9]\d*$/;
const DISUSED_PREFIXES = ["disused:", "abandoned:", "was:", "removed:"];

/** The brand facts of an OSM element's tags; null when the tags say nothing about a brand or closure. */
export function brandOfTags(tags: Record<string, string>): VenueBrand | null {
  const wikidata = QID.test((tags["brand:wikidata"] ?? "").trim())
    ? tags["brand:wikidata"].trim()
    : null;
  const name = (tags.brand ?? "").trim() || null;
  const disused =
    tags.disused === "yes" ||
    tags.abandoned === "yes" ||
    Object.keys(tags).some((k) => DISUSED_PREFIXES.some((p) => k.startsWith(p)));
  if (!wikidata && !name && !disused) return null;
  return { wikidata, name, disused };
}
