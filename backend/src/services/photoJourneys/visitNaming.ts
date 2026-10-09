import type { PlaceResult } from "../geo/photon";
import { isNonLatin, mergePlaceNames } from "../geo/placeNames";
import { categoryFromOsmValue } from "../../shared/placeCategories";
import { NAME_MATCH_RADIUS_M, type PlaceNameGeocoder } from "../places/placeNameBackfill";
import { distanceKm } from "./cluster";

/**
 * What to call a stop (forgejo#211): the nearest named thing within reach of
 * where the photos were taken, through the same two Photon questions the
 * place-name backfill asks — the names in English, and the names in the
 * place's own script — matched by OSM identity (`geo/placeNames.ts`).
 *
 * A road is not an answer. Photon's reverse lookup lists the street a point is
 * on before the palace it is in front of, and "Sajik-ro" is a place nobody
 * visits. So is the town the point lies in: a reverse hit of kind `city` names
 * the city, and the stop is a stop in it, not a visit to it.
 *
 * Null when nothing within `NAME_MATCH_RADIUS_M` had a name: the finding then
 * stands on its dates and photographs alone, and the user names it.
 */

export interface VisitName {
  name: string;
  /** The own-script name, only where it differs from `name` and is non-Latin. */
  localName: string | null;
  /** `osm:<type>/<id>`, the dedup key of `Place`. */
  ref: string | null;
  /** A `PlaceCategory` the OSM tag maps to; null when it maps to nothing in particular. */
  category: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
}

/** Photon `osm_value`s of ways people travel ALONG, not places they stop at. */
const ROAD_TYPES = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "pedestrian",
  "footway",
  "path",
  "cycleway",
  "steps",
  "track",
  "road",
  "bridleway",
  "corridor",
  "crossing",
  "bus_stop",
  "platform",
  "street",
]);

/** Photon hit kinds that name the AREA a point lies in rather than a thing at it. */
const AREA_TYPES = new Set([
  "house",
  "locality",
  "district",
  "city",
  "town",
  "village",
  "suburb",
  "neighbourhood",
  "county",
  "state",
  "country",
  "postcode",
  "administrative",
]);

function isPlaceToStopAt(hit: PlaceResult): boolean {
  const type = hit.type?.toLowerCase();
  return type === undefined || (!ROAD_TYPES.has(type) && !AREA_TYPES.has(type));
}

/** The nearest named object within reach, or null. */
function nearestNamed(
  hits: readonly PlaceResult[],
  at: { lat: number; lon: number }
): PlaceResult | null {
  let best: { hit: PlaceResult; m: number } | null = null;
  for (const hit of hits) {
    if (!isPlaceToStopAt(hit)) continue;
    const m = distanceKm(at, hit) * 1000;
    if (m > NAME_MATCH_RADIUS_M) continue;
    if (best === null || m < best.m) best = { hit, m };
  }
  return best?.hit ?? null;
}

export async function nameVisitStop(
  geocoder: PlaceNameGeocoder,
  at: { lat: number; lon: number }
): Promise<VisitName | null> {
  const [english, local] = await Promise.all([
    geocoder.reverseEnglish(at.lat, at.lon),
    geocoder.reverseDefault(at.lat, at.lon),
  ]);
  // Either lookup may have failed; the one that answered is asked. Both
  // failing is "no name", never a dropped finding.
  const requested = english ?? local;
  if (requested === null) return null;

  const chosen = nearestNamed(requested, at);
  if (chosen === null) return null;
  const [merged] = mergePlaceNames([chosen], english, local);
  const localName = merged.localName && isNonLatin(merged.localName) ? merged.localName : null;
  const category = categoryFromOsmValue(merged.type);
  return {
    name: merged.name,
    localName,
    ref: merged.externalRef ?? null,
    category: category === "other" ? null : category,
    city: merged.city ?? null,
    country: merged.country ?? null,
    countryCode: merged.countryCode?.toUpperCase() ?? null,
  };
}
