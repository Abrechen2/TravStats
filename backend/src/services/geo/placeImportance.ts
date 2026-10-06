/**
 * How important a nearby place is — the weight behind the order of
 * `GET /geo/reverse-places` (forgejo#209).
 *
 * The owner, standing in Seoul: the "Ort jetzt" list should put "das größte
 * und wichtigste oben" — the palace above the bus stop beside it. Photon's
 * `/reverse` has no importance score; it answers by distance only. At
 * Gyeongbokgung (measured against the public Photon, 2026-10-06) the palace
 * itself came fifth, behind two of its halls, the legal district and a
 * stationery shop, and among the nearest twenty it shares the list with a dozen
 * nameplate buildings and a ticket office. What it does send is each hit's OSM
 * tag (`osm_key`/`osm_value`) and its Photon `type`, and those are enough for a
 * stable weight.
 *
 * The scale is deliberately coarse — four tiers, not a score. A finer number
 * would claim a precision the tags do not carry ("is a museum 0.8 or 0.85 of
 * a palace?"), and within a tier distance decides, which is what the user can
 * check against the map.
 *
 * Note on Photon's `type`: it is `house` for practically every POI (a palace
 * is a "house" there), so it is read only for the area types (`city`,
 * `district`, `street`, …), never as "this is a house".
 */

export const PLACE_RANK = {
  /** Sights, stations, airports, big parks, the town itself. */
  HIGH: 3,
  /** Places people go to on purpose: hotels, restaurants, malls. */
  MIDDLE: 2,
  /** Everything not named below. */
  DEFAULT: 1,
  /** Street furniture, small shops, buildings, entrances, streets. */
  LOW: 0,
} as const;

export type PlaceRank = (typeof PLACE_RANK)[keyof typeof PLACE_RANK];

export interface PlaceKind {
  /** OSM tag key, Photon `osm_key` (`tourism`, `historic`, …). */
  osmKey?: string;
  /** OSM tag value, Photon `osm_value` (`museum`, `bus_stop`, …). */
  osmValue?: string;
  /** Photon's own `type` (`house`, `street`, `district`, `city`, …). */
  type?: string;
}

/** `key` → the values that put a hit in this tier; `"*"` = any value. */
type TagTable = Readonly<Record<string, readonly string[] | "*">>;

const HIGH: TagTable = {
  historic: "*",
  tourism: ["attraction", "museum", "viewpoint", "zoo", "theme_park", "aquarium", "gallery"],
  railway: ["station"],
  aeroway: ["aerodrome"],
  amenity: ["place_of_worship", "university"],
  leisure: ["park", "stadium"],
  place: ["city", "town", "suburb"],
};

const MIDDLE: TagTable = {
  tourism: ["hotel", "hostel", "guest_house", "motel", "apartment", "information"],
  amenity: [
    "restaurant",
    "cafe",
    "bar",
    "pub",
    "fast_food",
    "theatre",
    "cinema",
    "arts_centre",
    "library",
    "marketplace",
  ],
  shop: ["mall", "department_store"],
  leisure: ["garden", "nature_reserve"],
  natural: "*",
  place: ["village", "quarter", "neighbourhood", "square"],
};

const LOW: TagTable = {
  highway: "*",
  shop: "*",
  amenity: [
    "atm",
    "toilets",
    "parking",
    "parking_entrance",
    "bicycle_parking",
    "bench",
    "waste_basket",
    "vending_machine",
    "post_box",
    "telephone",
    "charging_station",
  ],
  entrance: "*",
  building: "*",
  place: ["house", "postcode", "plot"],
};

/** Photon area types that name the town the hit lies in, at its scale. */
const HIGH_AREA_TYPES = new Set(["city"]);
/** Photon types that are an address, not a place. */
const LOW_AREA_TYPES = new Set(["street", "house_number"]);

const matches = (table: TagTable, key: string, value: string): boolean => {
  const values = table[key];
  if (values === undefined) return false;
  return values === "*" || values.includes(value);
};

/**
 * The tier of one hit. A tag table is consulted HIGH first, then MIDDLE, then
 * LOW, so a specific entry beats a wildcard of the same key (`shop=mall` is
 * middle although `shop=*` is low). A boundary relation is ranked by the area
 * Photon says it is, since its own value (`administrative`, `legal`) says
 * nothing about size.
 */
export function placeImportance(kind: PlaceKind): PlaceRank {
  const key = kind.osmKey?.trim().toLowerCase() ?? "";
  const value = kind.osmValue?.trim().toLowerCase() ?? "";
  const type = kind.type?.trim().toLowerCase() ?? "";

  if (key === "boundary") {
    return HIGH_AREA_TYPES.has(type) ? PLACE_RANK.HIGH : PLACE_RANK.DEFAULT;
  }
  if (key) {
    if (matches(HIGH, key, value)) return PLACE_RANK.HIGH;
    if (matches(MIDDLE, key, value)) return PLACE_RANK.MIDDLE;
    if (matches(LOW, key, value)) return PLACE_RANK.LOW;
  }
  if (HIGH_AREA_TYPES.has(type)) return PLACE_RANK.HIGH;
  if (LOW_AREA_TYPES.has(type)) return PLACE_RANK.LOW;
  return PLACE_RANK.DEFAULT;
}
