import { contains, polygons, type MarketArea } from "../marketVisits/geometry";

/**
 * Which OSM element a stay was AT — the pure half of building recognition
 * (forgejo travtrack visit-detection spec, rule 3).
 *
 * Photon names points; it cannot say whether a point lies inside a building.
 * With the OSM outlines of the surrounding areas the stay can be ranked by
 * containment instead of by the nearest counter:
 *  1. the named area (building or grounds) whose outline contains the stay
 *     point beats any node;
 *  2. a node (or a smaller area) inside a named area folds into it when the
 *     containment is backed by evidence — the same brand / brand:wikidata /
 *     operator, or the area being the building it stands in. A shared brand
 *     alone never merges two branches (containment is always required),
 *     administrative and land-use areas never count as a venue, and a mall
 *     does not swallow a shop that has a building part of its own.
 * Photos and distance only decide what containment leaves open.
 */

/** Why the venue layer did or did not take part (a fixed vocabulary, shown on the card). */
export type VenueState =
  | "ok"
  /** Some outlines could not be built; the ranking ran on what was known. */
  | "partial"
  /** Open-data services are switched off on this instance. */
  | "off"
  | "timeout"
  | "rateLimited"
  /** The shared Overpass budget or lease was not available right now. */
  | "budget"
  | "unavailable";

export interface VenueElement {
  /** `node/1`, `way/2`, `relation/3`. */
  ref: string;
  tags: Record<string, string>;
  /** Outline with holes; null for a node or an outline that could not be built. */
  area: MarketArea | null;
  point: { lat: number; lon: number } | null;
}

export interface VenueEvidence {
  state: VenueState;
  elements: VenueElement[];
}

/** Keys that make a named OSM feature a place someone can be AT. */
const VENUE_KEYS = ["shop", "amenity", "tourism", "leisure", "office", "craft", "healthcare"];

export const venueName = (tags: Record<string, string>): string =>
  (tags["name:en"] || tags.name || "").trim();

/**
 * A named area that can be THE venue. Administrative, place and land-use-only
 * areas are context, never a venue: a "Stadtmitte" boundary containing every
 * stay in town would otherwise win every time.
 */
export function isVenueArea(el: VenueElement): boolean {
  if (!el.area || venueName(el.tags) === "") return false;
  const t = el.tags;
  if (t.boundary || t.admin_level || t.place) return false;
  return t.building !== undefined || t["building:part"] !== undefined || hasVenueKey(t);
}

const hasVenueKey = (t: Record<string, string>): boolean => VENUE_KEYS.some((k) => t[k]);

export function isMall(t: Record<string, string>): boolean {
  return t.shop === "mall" || t.amenity === "marketplace";
}

const norm = (v: string | undefined): string => (v ?? "").trim().toLowerCase();

/** The same brand or operator by an identifier, never by a similar name. */
export function sameBrand(a: Record<string, string>, b: Record<string, string>): boolean {
  for (const key of ["brand:wikidata", "brand", "operator"]) {
    const x = norm(a[key]);
    if (x !== "" && x === norm(b[key])) return true;
  }
  return false;
}

/** Plan-view size in m², enough to order nested outlines. */
export function areaSizeM2(area: MarketArea): number {
  let total = 0;
  for (const [outer, ...holes] of polygons(area)) {
    const ring = (r: readonly (readonly [number, number])[]): number => {
      const lat0 = r[0][1];
      const sx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
      let sum = 0;
      for (let i = 1; i < r.length; i++) {
        const [ax, ay] = [r[i - 1][0] * sx, r[i - 1][1] * 111_320];
        const [bx, by] = [r[i][0] * sx, r[i][1] * 111_320];
        sum += ax * by - bx * ay;
      }
      return Math.abs(sum) / 2;
    };
    total += ring(outer) - holes.reduce((s, h) => s + ring(h), 0);
  }
  return total;
}

export interface VenueEntity {
  ref: string | null;
  tags: Record<string, string>;
  at: { lat: number; lon: number };
  /** Size of the entity's own outline, null for a node. */
  sizeM2: number | null;
}

const containsPoint = (el: VenueElement, at: { lat: number; lon: number }): boolean =>
  el.area !== null && contains(el.area, at.lon, at.lat);

/** A building (part) of its own around the entity, smaller than the mall. */
function hasOwnPart(entity: VenueEntity, outer: VenueElement, elements: VenueElement[]): boolean {
  const outerSize = areaSizeM2(outer.area!);
  const isBuilding = (t: Record<string, string>) =>
    t.building !== undefined || t["building:part"] !== undefined;
  if (entity.sizeM2 !== null && entity.sizeM2 < outerSize && isBuilding(entity.tags)) return true;
  return elements.some(
    (el) =>
      el !== outer &&
      el.ref !== entity.ref &&
      isBuilding(el.tags) &&
      containsPoint(el, entity.at) &&
      areaSizeM2(el.area!) < outerSize
  );
}

function supports(entity: VenueEntity, outer: VenueElement, elements: VenueElement[]): boolean {
  if (sameBrand(entity.tags, outer.tags)) return true;
  if (isMall(outer.tags)) return !hasOwnPart(entity, outer, elements);
  // The building it sits in: a named building, not a part of one.
  return outer.tags.building !== undefined;
}

/**
 * The outermost named venue area that contains the entity AND is backed by
 * evidence; null when it stands alone.
 */
export function foldTarget(entity: VenueEntity, elements: VenueElement[]): VenueElement | null {
  const outers = elements
    .filter(
      (el) =>
        el.ref !== entity.ref &&
        isVenueArea(el) &&
        containsPoint(el, entity.at) &&
        (entity.sizeM2 === null || areaSizeM2(el.area!) > entity.sizeM2)
    )
    .sort((a, b) => areaSizeM2(b.area!) - areaSizeM2(a.area!));
  return outers.find((outer) => supports(entity, outer, elements)) ?? null;
}

export function entityOf(el: VenueElement, at: { lat: number; lon: number }): VenueEntity {
  return {
    ref: el.ref,
    tags: el.tags,
    at,
    sizeM2: el.area ? areaSizeM2(el.area) : null,
  };
}

export interface VenueResolution {
  /** The venue area the stay belongs to, or null (old ranking applies). */
  target: VenueElement | null;
  reason: "contains" | "folded" | null;
}

/**
 * Rule 1 first: the smallest named area around the stay point (then folded
 * outwards when evidence supports it). Otherwise the pick of the old ranking
 * (`fallbackPick`: a node with its own point) folds into its parent area.
 */
export function resolveVenue(
  point: { lat: number; lon: number },
  elements: VenueElement[],
  fallbackPick: {
    ref: string | null;
    tags: Record<string, string>;
    at: { lat: number; lon: number };
  } | null
): VenueResolution {
  const containing = elements
    .filter((el) => isVenueArea(el) && containsPoint(el, point))
    .sort((a, b) => areaSizeM2(a.area!) - areaSizeM2(b.area!));
  if (containing.length > 0) {
    const inner = containing[0];
    const outer = foldTarget(entityOf(inner, point), elements);
    return { target: outer ?? inner, reason: "contains" };
  }
  if (fallbackPick) {
    const parent = foldTarget(
      { ref: fallbackPick.ref, tags: fallbackPick.tags, at: fallbackPick.at, sizeM2: null },
      elements
    );
    if (parent) return { target: parent, reason: "folded" };
  }
  return { target: null, reason: null };
}
