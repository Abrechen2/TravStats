import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { findOsmLodging } from "./openStreetMap";
import { isWikidataId } from "./wikipedia";

/** The fields the enrichment may write — each only while it is still empty. */
export type EnrichedField = "stars" | "website" | "wikidataId" | "chain";

export interface LodgingEnrichment {
  /** Whether OpenStreetMap has this house at all. */
  found: boolean;
  /** Why nothing was looked up, when nothing was. */
  reason: "noCoordinates" | "notFound" | null;
  osmRef: string | null;
  osmName: string | null;
  filled: EnrichedField[];
}

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

/**
 * Fill a lodging's empty fields from its OpenStreetMap entry (beta,
 * `lodgingEnrichment`). Never overwrites: a value the user typed, or that an
 * import brought, is theirs. A chain is only linked when the catalogue already
 * knows the brand — an unknown one is an offer elsewhere, never a silent
 * create (same rule as the import preview).
 */
export async function enrichLodgingFromOsm(
  userId: string,
  lodgingId: string
): Promise<LodgingEnrichment> {
  const lodging = await prisma.lodging.findFirst({ where: { id: lodgingId, userId } });
  if (!lodging) throw new AppError("Lodging not found", 404);
  if (lodging.lat === null || lodging.lon === null) {
    return { found: false, reason: "noCoordinates", osmRef: null, osmName: null, filled: [] };
  }

  const hit = await findOsmLodging(lodging.lat, lodging.lon, lodging.name);
  if (!hit) return { found: false, reason: "notFound", osmRef: null, osmName: null, filled: [] };

  const { tags } = hit;
  const stars = lodging.stars === null ? starsFromOsm(tags.stars) : null;
  const website =
    lodging.website === null ? websiteFromOsm(tags.website ?? tags["contact:website"]) : null;
  const wikidataId =
    lodging.wikidataId === null && isWikidataId(tags.wikidata) ? tags.wikidata : null;
  const brand = tags.brand?.trim();
  const chain =
    lodging.chainId === null && brand
      ? await prisma.lodgingChain.findFirst({
          where: { name: { equals: brand, mode: "insensitive" } },
          select: { id: true },
        })
      : null;

  const filled: EnrichedField[] = [
    ...(stars !== null ? (["stars"] as const) : []),
    ...(website !== null ? (["website"] as const) : []),
    ...(wikidataId !== null ? (["wikidataId"] as const) : []),
    ...(chain !== null ? (["chain"] as const) : []),
  ];
  if (filled.length > 0) {
    await prisma.lodging.update({
      where: { id: lodging.id },
      data: {
        ...(stars !== null && { stars }),
        ...(website !== null && { website }),
        ...(wikidataId !== null && { wikidataId }),
        ...(chain !== null && { chainId: chain.id }),
      },
    });
  }
  logger.info({ operation: "lodging_osm_enrichment", lodgingId, osmRef: hit.osmRef, filled });
  return { found: true, reason: null, osmRef: hit.osmRef, osmName: hit.name, filled };
}
