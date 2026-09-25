/**
 * The two OpenStreetMap tag values TravStats lets into a lodging record, and
 * the rule each must pass first. Shared by the enrichment of a saved house
 * and the nearby list the lodging form picks from, so a value the one refuses
 * cannot enter through the other.
 */

/** OSM writes stars as "4", sometimes "4S" (superior) or "3.5"; only a clean 1–5 counts. */
export function starsFromOsm(raw: string | undefined): number | null {
  const match = raw?.trim().match(/^([1-5])(?:\s*S|\.0)?$/i);
  return match ? Number(match[1]) : null;
}

/** Only an absolute http(s) address is a website; anything else stays out of the record. */
export function websiteFromOsm(raw: string | undefined): string | null {
  if (!raw || raw.length > 500) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
