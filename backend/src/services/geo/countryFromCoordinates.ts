/**
 * `(lat, lon)` -> ISO 3166-1 alpha-2, or null.
 *
 * Design: `docs/superpowers/specs/2026-09-02-country-counting-design.md` §8.
 * The boundaries and the index behind this live in `countryBoundaries.ts`; this
 * file is only the question and the abstention rules.
 *
 * NOTHING CALLS THIS YET, and that is correct. The design's order of work puts
 * the Dawarich sweep, the country-day storage and the `transited` tier AFTER
 * the boundaries exist. This is the library they will use.
 *
 * ## When it answers null
 *
 * Every one of these is an abstention, never a fallback to a nearby country:
 *
 * - the sea, and any coordinate outside every outline;
 * - Antarctica — see `UNATTRIBUTED_CODES` in `countryBoundaries.ts`;
 * - the areas Natural Earth itself does not attribute (Somaliland, Northern
 *   Cyprus, Bir Tawil, Siachen Glacier and ten more), which the vendored file
 *   omits because assigning them to a claimant would be inventing the answer;
 * - a coordinate that is not a coordinate (NaN, or off the graticule).
 *
 * The whole country rework exists because a value was inferred where none was
 * known. A guess here would reintroduce that from a new direction.
 */

import { toCountryCode } from "../../shared/countryEvidence";
import {
  CountryBoundaryIndex,
  getCountryBoundaryIndex,
  COUNTRY_BOUNDARIES_PATH,
} from "./countryBoundaries";

/** Even-odd crossing test against ONE ring, using its latitude-band index. */
function isInsideRing(index: CountryBoundaryIndex, ring: number, lon: number, lat: number): boolean {
  const bandBase = index.ringBandStart[ring];
  const bandCount = index.ringBandStart[ring + 1] - bandBase;
  const height = index.ringBandHeight[ring];
  // Clamping rather than rejecting an out-of-range latitude: a query below or
  // above the ring finds no crossing in the clamped band anyway, and clamping
  // keeps the query on the same side of the boundary as the edge registration
  // did, which an equality test at exactly `latMax` would not.
  const band =
    height === 0
      ? 0
      : Math.max(
          0,
          Math.min(bandCount - 1, Math.floor((lat - index.ringLatMin[ring]) / height))
        );

  const from = index.bandEdgeStart[bandBase + band];
  const to = index.bandEdgeStart[bandBase + band + 1];
  const coords = index.coords;
  let inside = false;
  for (let e = from; e < to; e++) {
    const edge = index.bandEdges[e] * 2;
    const lonA = coords[edge];
    const latA = coords[edge + 1];
    const lonB = coords[edge + 2];
    const latB = coords[edge + 3];
    if (latA > lat !== latB > lat) {
      const crossing = ((lonB - lonA) * (lat - latA)) / (latB - latA) + lonA;
      if (lon < crossing) inside = !inside;
    }
  }
  return inside;
}

function isInsidePart(index: CountryBoundaryIndex, part: number, lon: number, lat: number): boolean {
  const firstRing = index.partRingStart[part];
  const lastRing = index.partRingStart[part + 1];
  if (!isInsideRing(index, firstRing, lon, lat)) return false;
  // Ring 0 is the outline, the rest are holes — an enclave punched out of it
  // (Lesotho inside South Africa, Vatican City inside Italy) is NOT this part.
  for (let ring = firstRing + 1; ring < lastRing; ring++) {
    if (isInsideRing(index, ring, lon, lat)) return false;
  }
  return true;
}

/**
 * The lookup, synchronous once the index exists.
 *
 * Candidates come out of the grid in ascending part order and the FIRST hit
 * wins, so the answer is deterministic for the rare coordinate two outlines
 * both claim. Determinism is the property §8.1 asks for: the same track must
 * yield the same countries on every instance.
 */
export function countryCodeAt(
  index: CountryBoundaryIndex,
  lat: number,
  lon: number
): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const column = Math.min(359, Math.max(0, Math.floor(lon + 180)));
  const row = Math.min(179, Math.max(0, Math.floor(lat + 90)));
  const cell = row * 360 + column;

  const from = index.cellStart[cell];
  const to = index.cellStart[cell + 1];
  for (let c = from; c < to; c++) {
    const part = index.cellParts[c];
    const box = part * 4;
    if (
      lon < index.partBox[box] ||
      lon > index.partBox[box + 2] ||
      lat < index.partBox[box + 1] ||
      lat > index.partBox[box + 3]
    ) {
      continue;
    }
    if (isInsidePart(index, part, lon, lat)) {
      // Through the one home. `shared/countryEvidence.ts` owns the join from
      // anything-country-shaped to a code, and it exists because a consumer
      // that resolves its own way disagrees with the count invisibly. It also
      // rejects the placeholder codes `ZZ`/`XZ`, so a dataset that ever grew
      // one cannot leak it into a passport.
      return toCountryCode(index.partCodes[part]);
    }
  }
  return null;
}

/** A loaded index with the question bound to it. */
export interface CountryResolver {
  /** ISO 3166-1 alpha-2, or null when no country can be asserted. */
  countryAt(lat: number, lon: number): string | null;
  /** Every code this dataset can ever answer — "can it see Monaco" has an answer. */
  readonly codes: ReadonlySet<string>;
  /** Where the boundaries were read from; useful when a container is missing them. */
  readonly dataPath: string;
}

/**
 * Loads the boundaries once and hands back the resolver.
 *
 * Deliberately split from `countryAt` so a sweep pays the load once and then
 * classifies synchronously — a promise per point would cost more than the ray
 * cast does.
 */
export async function getCountryResolver(): Promise<CountryResolver> {
  const index = await getCountryBoundaryIndex();
  return {
    countryAt: (lat, lon) => countryCodeAt(index, lat, lon),
    codes: index.codes,
    dataPath: COUNTRY_BOUNDARIES_PATH,
  };
}

/** One-shot convenience. Use `getCountryResolver` when classifying many points. */
export async function countryFromCoordinates(lat: number, lon: number): Promise<string | null> {
  return (await getCountryResolver()).countryAt(lat, lon);
}
