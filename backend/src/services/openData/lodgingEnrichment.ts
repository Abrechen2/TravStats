import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { findVisibleChainByName, visibleChainsWhere } from "../lodging/chainScope";
import { osmRefToStore } from "../lodging/osmRef";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import type { OpenDataFailure } from "./http";
import { findOsmLodging, type NearbyLodging, type OsmLodging } from "./openStreetMap";
import { starsFromOsm, websiteFromOsm } from "./osmValues";
import { isWikidataId } from "./wikipedia";

// Re-exported: the enrichment tests name this module for them.
export { starsFromOsm, websiteFromOsm };

/** The fields the enrichment may write — each only while it is still empty. */
export type EnrichedField = "stars" | "website" | "wikidataId" | "chain";

/** Why no house came back. `notFound` is OpenStreetMap's answer; a failure
 *  (`timeout`, `rateLimited`, `unavailable`) means it could not be asked;
 *  `matchChanged` means the house the user confirmed is no longer the match. */
export type EnrichmentReason =
  "noCoordinates" | "notFound" | "matchChanged" | OpenDataFailure | null;

/** The OpenStreetMap object the enrichment matched — what the user checks. */
export interface OsmMatch {
  osmRef: string;
  osmType: "node" | "way" | "relation";
  osmId: number;
  name: string;
  /** Metres from the lodging's stored pin. */
  distanceM: number;
  url: string;
}

/** One field OpenStreetMap has a value for. `apply: false` is a value the
 *  lodging already holds and keeps — shown, because a disagreement there is
 *  how a wrong match gets noticed. */
export interface FieldProposal {
  field: EnrichedField;
  current: string | number | null;
  proposed: string | number;
  apply: boolean;
}

export interface LodgingEnrichmentPreview {
  found: boolean;
  reason: EnrichmentReason;
  match: OsmMatch | null;
  fields: FieldProposal[];
  /** Whether applying also records the match as the lodging's `externalRef`. */
  storesReference: boolean;
}

export interface LodgingEnrichment {
  /** Whether OpenStreetMap has this house at all. */
  found: boolean;
  reason: EnrichmentReason;
  osmRef: string | null;
  osmName: string | null;
  filled: EnrichedField[];
  match: OsmMatch | null;
  /** True when the match was written to `externalRef` (it was still empty). */
  referenceStored: boolean;
}

const OSM_REF = /^osm:(node|way|relation)\/(\d+)$/;

function toMatch(hit: OsmLodging): OsmMatch {
  const [, type, id] = hit.osmRef.match(OSM_REF) ?? [];
  const osmType = (type ?? "node") as OsmMatch["osmType"];
  return {
    osmRef: hit.osmRef,
    osmType,
    osmId: Number(id),
    name: hit.name,
    distanceM: hit.distanceM,
    url: `https://www.openstreetmap.org/${osmType}/${id}`,
  };
}

type LodgingRow = NonNullable<Awaited<ReturnType<typeof loadLodging>>>;

function loadLodging(userId: string, lodgingId: string) {
  return prisma.lodging.findFirst({
    where: { id: lodgingId, userId },
    include: { chain: { select: { id: true, name: true } } },
  });
}

interface Proposal {
  lodging: LodgingRow;
  match: OsmMatch;
  fields: FieldProposal[];
  /** The chain to link when `chain` applies. */
  chainId: number | null;
  reference: string | undefined;
}

type Lookup = Proposal | { found: false; reason: Exclude<EnrichmentReason, null> };

/**
 * What the enrichment would do, without doing it: the matched house and, per
 * field OpenStreetMap has a value for, the lodging's value beside it. Only an
 * empty field is proposed; a filled one is listed as kept.
 */
async function propose(userId: string, lodgingId: string): Promise<Lookup> {
  const lodging = await loadLodging(userId, lodgingId);
  if (!lodging) throw new AppError("Lodging not found", 404);
  if (lodging.lat === null || lodging.lon === null) {
    return { found: false, reason: "noCoordinates" };
  }
  const hit = await findOsmLodging(lodging.lat, lodging.lon, lodging.name);
  if (!hit) return { found: false, reason: "notFound" };
  if ("failure" in hit) return { found: false, reason: hit.failure };

  const { tags } = hit;
  const stars = starsFromOsm(tags.stars);
  const website = websiteFromOsm(tags.website ?? tags["contact:website"]);
  const wikidataId = isWikidataId(tags.wikidata) ? tags.wikidata : null;
  const brand = tags.brand?.trim();
  const chain = brand ? await findVisibleChainByName(userId, brand) : null;

  const fields: FieldProposal[] = [];
  const offer = (field: EnrichedField, current: string | number | null, osm: string | number) => {
    // A filled field that already says the same is not news.
    if (current !== null && current === osm) return;
    fields.push({ field, current, proposed: osm, apply: current === null });
  };
  if (stars !== null) offer("stars", lodging.stars, stars);
  if (website !== null) offer("website", lodging.website, website);
  if (wikidataId !== null) offer("wikidataId", lodging.wikidataId, wikidataId);
  if (chain !== null && chain.id !== lodging.chainId) {
    fields.push({
      field: "chain",
      current: lodging.chain?.name ?? null,
      proposed: chain.name,
      apply: lodging.chainId === null,
    });
  }
  const reference = await osmRefToStore(userId, hit.osmRef, lodging);
  return { lodging, match: toMatch(hit), fields, chainId: chain?.id ?? null, reference };
}

/** The preview: what applying would fill, and which house it comes from. Writes nothing. */
export async function previewLodgingEnrichment(
  userId: string,
  lodgingId: string
): Promise<LodgingEnrichmentPreview> {
  const lookup = await propose(userId, lodgingId);
  if (!("match" in lookup)) {
    return { found: false, reason: lookup.reason, match: null, fields: [], storesReference: false };
  }
  return {
    found: true,
    reason: null,
    match: lookup.match,
    fields: lookup.fields,
    storesReference: lookup.reference !== undefined,
  };
}

/**
 * Fill a lodging's empty fields from its OpenStreetMap entry (beta,
 * `lodgingEnrichment`). Never overwrites: a value the user typed, or that an
 * import brought, is theirs. A chain is only linked when the catalogue already
 * knows the brand — an unknown one is an offer elsewhere, never a silent
 * create (same rule as the import preview).
 *
 * `expectedOsmRef` is the house the user saw in the preview. Overpass is asked
 * again here, and when it now names another house (or none), nothing is
 * written: the user confirmed a house, not "whatever matches now".
 *
 * The match is recorded as the lodging's `externalRef` under the fill-empty
 * rule of `osmRefToStore`, so a wrong match can still be found afterwards.
 */
export async function enrichLodgingFromOsm(
  userId: string,
  lodgingId: string,
  expectedOsmRef?: string
): Promise<LodgingEnrichment> {
  const lookup = await propose(userId, lodgingId);
  const none = { osmRef: null, osmName: null, filled: [], match: null, referenceStored: false };
  if (!("match" in lookup)) {
    const reason = expectedOsmRef && lookup.reason === "notFound" ? "matchChanged" : lookup.reason;
    return { found: false, reason, ...none };
  }
  const { lodging, match, fields, chainId, reference } = lookup;
  if (expectedOsmRef && expectedOsmRef !== match.osmRef) {
    return { found: false, reason: "matchChanged", ...none };
  }

  const applied = fields.filter((f) => f.apply);
  const value = (field: EnrichedField) => applied.find((f) => f.field === field)?.proposed;
  const stars = value("stars");
  const website = value("website");
  const wikidataId = value("wikidataId");
  const linkChain = value("chain") !== undefined && chainId !== null;

  // One conditional write per field, each only while that field is STILL
  // empty: Overpass was asked between reading the lodging and this write, and
  // a value the user saved meanwhile is theirs. Only what landed is reported.
  const writes: Array<{
    field: EnrichedField | "externalRef";
    data: Prisma.LodgingUpdateManyMutationInput;
  }> = [
    ...(typeof stars === "number" ? [{ field: "stars" as const, data: { stars } }] : []),
    ...(typeof website === "string" ? [{ field: "website" as const, data: { website } }] : []),
    ...(typeof wikidataId === "string"
      ? [{ field: "wikidataId" as const, data: { wikidataId } }]
      : []),
    ...(reference !== undefined
      ? [{ field: "externalRef" as const, data: { externalRef: reference } }]
      : []),
  ];
  const results = await prisma.$transaction([
    ...writes.map(({ field, data }) =>
      prisma.lodging.updateMany({ where: { id: lodging.id, [field]: null }, data })
    ),
    ...(linkChain
      ? [prisma.lodging.updateMany({ where: { id: lodging.id, chainId: null }, data: { chainId } })]
      : []),
  ]);
  const landed = [...writes.map((w) => w.field), ...(linkChain ? ["chain" as const] : [])].filter(
    (_, i) => results[i].count > 0
  );
  const filled = landed.filter((f): f is EnrichedField => f !== "externalRef");
  const referenceStored = landed.includes("externalRef");

  logger.info({ operation: "lodging_osm_enrichment", lodgingId, filled });
  logger.debug({ operation: "lodging_osm_enrichment", lodgingId, osmRef: match.osmRef });
  return {
    found: true,
    reason: null,
    osmRef: match.osmRef,
    osmName: match.name,
    filled,
    match,
    referenceStored,
  };
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
  userId: string,
  places: NearbyLodging[]
): Promise<NearbyLodgingWithChain[]> {
  const brands = [...new Set(places.flatMap((p) => (p.brand ? [p.brand] : [])))];
  const chains =
    brands.length === 0
      ? []
      : await prisma.lodgingChain.findMany({
          where: {
            AND: [
              visibleChainsWhere(userId),
              { OR: brands.map((b) => ({ name: { equals: b, mode: "insensitive" as const } })) },
            ],
          },
          // Own rows first, catalogue rows LAST: the map below keeps the last
          // entry per name, so the catalogue chain wins a name clash — the
          // same precedence as `findVisibleChainByName`.
          orderBy: [{ userId: { sort: "desc", nulls: "last" } }, { id: "asc" }],
          select: CHAIN_SELECT,
          take: brands.length * 2,
        });
  const byName = new Map(chains.map((c) => [c.name.toLowerCase(), c]));
  return places.map((p) => ({
    ...p,
    chain: (p.brand && byName.get(p.brand.toLowerCase())) || null,
  }));
}
