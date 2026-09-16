import { namesCouldBeOneHouse, sharedSignificantTokens } from "./nameSimilarity";
import { metresBetween } from "./proximityMatch";

/**
 * "Is this that house?" — answered by the server, once (forgejo#118).
 *
 * The Companion used to decide this on its own, by lowercasing the name and
 * the city and demanding both match exactly. Measured on a real hotel invoice
 * photographed by the app on 2026-09-10: the OCR read "Oplikon" for Opfikon
 * and "Schalfhauserstrasse" for Schaffhauserstrasse, at confidence 67. One
 * letter in the city was enough — the keys differed, the app created a second
 * hotel, and the NEXT scan could duplicate it again because the first
 * duplicate is stored under the misread name.
 *
 * Two reasons this belongs on the server and not in a client:
 *
 *   1. It can geocode the incoming address, which the parse does not do, and
 *      then compare COORDINATES. A name can be misread; a building cannot
 *      move. That is the whole answer to an OCR typo.
 *   2. One rule in one place. Every client re-implementing a fuzzy comparison
 *      is every client getting it differently wrong.
 *
 * This NEVER merges. It answers a question good enough to ask the person
 * about — today a one-character difference means the question is never raised.
 */

/** A stored house, as much of it as the decision needs. */
export interface StoredLodging {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  stayCount: number;
}

/** What the scan produced, after the server has tried to geocode it. */
export interface IncomingLodging {
  name: string;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface LodgingMatch {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  distanceMetres: number | null;
  stayCount: number;
  /** Columns the stored row is missing that this scan could complete. */
  fillsFields: string[];
}

export interface LodgingProposal {
  action: "create" | "merge";
  match: LodgingMatch | null;
  /** Why it matched, so a client can say so rather than guess. */
  reason: "coordinates" | "name" | null;
  confidence: number;
}

/**
 * Two houses this close are one house.
 *
 * 75 m rather than a tighter figure because a geocoded street address lands on
 * the street, not on the door, and a large hotel's own footprint is bigger than
 * that. Wider than this starts folding a chain's two brands in one city block
 * together — which `proximityMatch` already warns can genuinely be two houses.
 */
const SAME_BUILDING_METRES = 75;

/** Close enough to ask about, far enough that the answer is not obvious. */
const SAME_BLOCK_METRES = 250;

/**
 * Ordinal, not a probability.
 *
 * The numbers exist so a client can sort candidates and pick a threshold; they
 * are not calibrated against anything and must not be shown to a user as a
 * percentage. What they encode is the order of evidence: a building's position
 * beats its name, and a name with a town beats a name without one.
 */
const CONFIDENCE = {
  sameBuilding: 0.95,
  sameBlock: 0.75,
  nameAndCity: 0.7,
  nameOnly: 0.55,
} as const;

const normalizeCity = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const folded = value.trim().toLowerCase();
  return folded === "" ? null : folded;
};

/**
 * Does the caller know these two are in the same town?
 *
 * `null` — not `false` — when either side has no city: a saved-places export
 * carries none, and reading "unknown" as "different" is what turns a missing
 * field into a refusal to match.
 */
function citiesAgree(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const left = normalizeCity(a);
  const right = normalizeCity(b);
  if (left === null || right === null) return null;
  return left === right;
}

/** What this scan could add to a row that is missing it. */
function fillsFieldsFor(stored: StoredLodging, incoming: IncomingLodging): string[] {
  const fills: string[] = [];
  const has = (value: string | null | undefined): boolean =>
    typeof value === "string" && value.trim() !== "";

  if (has(incoming.address) && !has(stored.address)) fills.push("address");
  if (has(incoming.city) && !has(stored.city)) fills.push("city");
  if (has(incoming.country) && !has(stored.country)) fills.push("country");
  if (
    typeof incoming.lat === "number" &&
    typeof incoming.lon === "number" &&
    (stored.lat === null || stored.lon === null)
  ) {
    fills.push("coordinates");
  }
  return fills;
}

function toMatch(
  stored: StoredLodging,
  incoming: IncomingLodging,
  distanceMetres: number | null,
): LodgingMatch {
  return {
    id: stored.id,
    name: stored.name,
    address: stored.address,
    city: stored.city,
    distanceMetres: distanceMetres === null ? null : Math.round(distanceMetres),
    stayCount: stored.stayCount,
    fillsFields: fillsFieldsFor(stored, incoming),
  };
}

/**
 * The best candidate among the user's houses, or none.
 *
 * Position is consulted first and wins outright, because it is the evidence the
 * client could not have. Only when one side has no pin does the name decide,
 * and then under the existing `namesCouldBeOneHouse` rule — which already
 * refuses two towns and already knows that one shared identifying word inside
 * one town is enough.
 */
export function proposeLodgingMatch(
  stored: ReadonlyArray<StoredLodging>,
  incoming: IncomingLodging,
): LodgingProposal {
  const pinned =
    typeof incoming.lat === "number" && typeof incoming.lon === "number"
      ? stored
          .filter(
            (c): c is StoredLodging & { lat: number; lon: number } =>
              typeof c.lat === "number" && typeof c.lon === "number",
          )
          .map((candidate) => ({
            candidate,
            distance: metresBetween(
              incoming.lat as number,
              incoming.lon as number,
              candidate.lat,
              candidate.lon,
            ),
          }))
          .sort((a, b) => a.distance - b.distance)
      : [];

  const nearest = pinned[0];
  if (nearest && nearest.distance <= SAME_BLOCK_METRES) {
    return {
      action: "merge",
      match: toMatch(nearest.candidate, incoming, nearest.distance),
      reason: "coordinates",
      confidence:
        nearest.distance <= SAME_BUILDING_METRES
          ? CONFIDENCE.sameBuilding
          : CONFIDENCE.sameBlock,
    };
  }

  // No usable pin on one side — fall back to the name, under the rule that
  // already exists for the import preview.
  let best: { candidate: StoredLodging; shared: number; sameCity: boolean | null } | null = null;
  for (const candidate of stored) {
    const sameCity = citiesAgree(candidate.city, incoming.city);
    if (!namesCouldBeOneHouse(candidate.name, incoming.name, sameCity)) continue;
    const shared = sharedSignificantTokens(candidate.name, incoming.name).length;
    if (best === null || shared > best.shared) {
      best = { candidate, shared, sameCity };
    }
  }

  if (best === null) {
    return { action: "create", match: null, reason: null, confidence: 0 };
  }

  return {
    action: "merge",
    match: toMatch(best.candidate, incoming, null),
    reason: "name",
    confidence: best.sameCity === true ? CONFIDENCE.nameAndCity : CONFIDENCE.nameOnly,
  };
}
