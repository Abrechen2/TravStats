import { haversineKm } from "../../../shared/geo/haversine";
import type { PlaceResult } from "../../geo/photon";

/**
 * Which nearby places a TravTrack stop offers, and in what order (measured on
 * rc.22 against real data, 4 Nov 2026). Photon's reverse lookup answers by
 * distance, and distance alone offered the street (28 m), a parcel locker
 * before the Lidl beside it and a vending machine before the charger the owner
 * actually charged at. A stop is a place somebody went to, so:
 *  - roads are never a destination and drop out;
 *  - street furniture drops out (it is on every pavement and names nothing);
 *  - a destination type outranks everything else, nearest first within a tier.
 * Types are the geocoder's `type` (OSM value, or the OSM key for a shop / leisure hit).
 */

/** Highways, paths and their links: the street a phone stood beside, not a stop. */
const ROAD_TYPES: ReadonlySet<string> = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "track",
  "road",
  "path",
  "footway",
  "cycleway",
  "pedestrian",
  "steps",
  "bridleway",
  "bus_stop",
  "street",
]);

const isRoad = (type: string): boolean => ROAD_TYPES.has(type) || type.endsWith("_link");

/** Street furniture and small utilities; offered as a stop they only ever mislead. */
const FURNITURE_TYPES: ReadonlySet<string> = new Set([
  "vending_machine",
  "parcel_locker",
  "bench",
  "waste_basket",
  "waste_disposal",
  "atm",
  "post_box",
  "bicycle_parking",
  "bicycle_repair_station",
  "telephone",
  "drinking_water",
  "recycling",
  "shelter",
  "toilets",
  "street_lamp",
  "give_way",
  "crossing",
  "entrance",
  "gate",
]);

/** Places people drive to on purpose; they come before any other named place. */
const DESTINATION_TYPES: ReadonlySet<string> = new Set([
  "hotel",
  "hostel",
  "guest_house",
  "motel",
  "apartment",
  "chalet",
  "camp_site",
  "caravan_site",
  "charging_station",
  "fuel",
  "supermarket",
  "restaurant",
  "cafe",
  "fast_food",
  "food_court",
  "pub",
  "bar",
  "biergarten",
  "office",
  "company",
  "commercial",
  "industrial",
  "bank",
  "mall",
  "department_store",
]);

/** Inside this distance every kept type is offered. */
export const STOP_NEAR_M = 100;

/**
 * Beyond `STOP_NEAR_M` only buildings a phone stands next to without standing
 * ON them are offered (an office tower's entrance is on the far side of its
 * footprint — the Mercedes-Benz Bank case); a shop 180 m away is the next one.
 */
const FAR_DESTINATION_TYPES: ReadonlySet<string> = new Set([
  "office",
  "company",
  "commercial",
  "industrial",
  "bank",
  "hotel",
  "mall",
  "department_store",
]);

/** Lookup radius: the near ring plus room for a large building's far side. */
export const STOP_LOOKUP_RADIUS_KM = 0.2;

const DESTINATION_WEIGHT = 2;
const OTHER_WEIGHT = 1;

const weightOf = (type: string | undefined): number =>
  type !== undefined && DESTINATION_TYPES.has(type) ? DESTINATION_WEIGHT : OTHER_WEIGHT;

export function rankStopCandidates(
  hits: readonly PlaceResult[],
  origin: { lat: number; lon: number }
): PlaceResult[] {
  return hits
    .map((place, index) => ({
      place,
      index,
      metres: haversineKm(origin, place) * 1000,
      type: place.type?.toLowerCase(),
    }))
    .filter(
      ({ type, metres }) =>
        !(type !== undefined && (isRoad(type) || FURNITURE_TYPES.has(type))) &&
        (metres <= STOP_NEAR_M || (type !== undefined && FAR_DESTINATION_TYPES.has(type)))
    )
    .sort(
      (a, b) =>
        // The far ring is listed after the near one: it must not crowd a near hit out of the
        // card's short list, nor become the probable place (which is capped near the stop).
        Number(a.metres > STOP_NEAR_M) - Number(b.metres > STOP_NEAR_M) ||
        weightOf(b.type) - weightOf(a.type) ||
        a.metres - b.metres ||
        a.index - b.index
    )
    .map(({ place }) => place);
}
