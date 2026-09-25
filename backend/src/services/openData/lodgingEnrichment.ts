import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { findOsmLodging, type NearbyLodging } from "./openStreetMap";
import { starsFromOsm, websiteFromOsm } from "./osmValues";
import { isWikidataId } from "./wikipedia";

// Re-exported: the enrichment tests name this module for them.
export { starsFromOsm, websiteFromOsm };

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

/** A catalogue chain as the lodging form's chain picker holds it. */
const CHAIN_SELECT = {
  id: true,
  name: true,
  brandColor: true,
  loyaltyProgram: true,
  isUserAdded: true,
  createdAt: true,
} as const;

export type NearbyLodgingWithChain = NearbyLodging & {
  chain: {
    id: number;
    name: string;
    brandColor: string | null;
    loyaltyProgram: string | null;
    isUserAdded: boolean;
    createdAt: Date;
  } | null;
};

/**
 * Each nearby house's `brand`, resolved to the catalogue chain of that name —
 * the same rule the enrichment links by: a known brand is linked, an unknown
 * one is left for the user rather than created. One query for the whole list.
 */
export async function withCatalogueChains(
  places: NearbyLodging[]
): Promise<NearbyLodgingWithChain[]> {
  const brands = [...new Set(places.flatMap((p) => (p.brand ? [p.brand] : [])))];
  const chains =
    brands.length === 0
      ? []
      : await prisma.lodgingChain.findMany({
          where: { OR: brands.map((b) => ({ name: { equals: b, mode: "insensitive" as const } })) },
          select: CHAIN_SELECT,
          take: brands.length * 2,
        });
  const byName = new Map(chains.map((c) => [c.name.toLowerCase(), c]));
  return places.map((p) => ({
    ...p,
    chain: (p.brand && byName.get(p.brand.toLowerCase())) || null,
  }));
}
