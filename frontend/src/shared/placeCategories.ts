/**
 * The place-category vocabulary.
 *
 * A category drives the pin's ICON and the list's row glyph — deliberately NOT
 * the pin's colour. On a map any two categories can end up adjacent, which is
 * the all-pairs case for colour separation, and only about three categorical
 * hues survive it. Seven categories cannot be seven hues, so the encoding is
 * shape, not colour; an icon also survives greyscale, print and forced-colours,
 * which a hue does not.
 *
 * `other` is the fold-to bucket and must stay last: it is the default on the
 * column and the landing place for anything an import cannot classify.
 *
 * MIRRORED from `backend/src/shared/placeCategories.ts` — same convention as
 * shared/domains.ts. Change both together.
 */

export const PLACE_CATEGORIES = [
  "restaurant",
  "landmark",
  "nature",
  "museum",
  "entertainment",
  "shopping",
  "viewpoint",
  "other",
] as const;

export type PlaceCategory = (typeof PLACE_CATEGORIES)[number];

/** The glyph each category renders as. Kept here so the map layer, the list
 *  and the picker cannot drift into three different icon sets. */
export const PLACE_CATEGORY_ICONS: Record<PlaceCategory, string> = {
  restaurant: "🍟",
  landmark: "🏛",
  nature: "🌲",
  museum: "🖼",
  entertainment: "🎭",
  shopping: "🛍",
  viewpoint: "🔭",
  other: "📍",
};

export function isPlaceCategory(value: unknown): value is PlaceCategory {
  return typeof value === "string" && (PLACE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Category for a raw geocoder `type`/`osm_value` string, or `other`.
 *
 * Best-effort by design: the picker shows the guess and the user can change it
 * before saving. A wrong guess is cheap here because only an icon depends on
 * it — nothing counted, nothing coloured.
 */
const OSM_VALUE_TO_CATEGORY: Record<string, PlaceCategory> = {
  restaurant: "restaurant",
  fast_food: "restaurant",
  cafe: "restaurant",
  bar: "restaurant",
  pub: "restaurant",
  biergarten: "restaurant",
  food_court: "restaurant",
  ice_cream: "restaurant",
  attraction: "landmark",
  monument: "landmark",
  memorial: "landmark",
  castle: "landmark",
  ruins: "landmark",
  // Acceptance 2026-09-26: Photon's "Kolosseum, Rom" is historic/
  // archaeological_site, which fell to "other". The common tourism, historic,
  // amenity and building values a sight carries in OSM:
  archaeological_site: "landmark",
  historic: "landmark",
  heritage: "landmark",
  fort: "landmark",
  city_gate: "landmark",
  palace: "landmark",
  manor: "landmark",
  tower: "landmark",
  lighthouse: "landmark",
  fountain: "landmark",
  place_of_worship: "landmark",
  church: "landmark",
  cathedral: "landmark",
  chapel: "landmark",
  mosque: "landmark",
  synagogue: "landmark",
  temple: "landmark",
  shrine: "landmark",
  monastery: "landmark",
  bridge: "landmark",
  museum: "museum",
  gallery: "museum",
  artwork: "museum",
  arts_centre: "museum",
  planetarium: "museum",
  park: "nature",
  nature_reserve: "nature",
  peak: "nature",
  beach: "nature",
  waterfall: "nature",
  forest: "nature",
  wood: "nature",
  garden: "nature",
  national_park: "nature",
  protected_area: "nature",
  volcano: "nature",
  glacier: "nature",
  cave_entrance: "nature",
  cliff: "nature",
  island: "nature",
  bay: "nature",
  lake: "nature",
  water: "nature",
  spring: "nature",
  valley: "nature",
  gorge: "nature",
  theatre: "entertainment",
  cinema: "entertainment",
  stadium: "entertainment",
  zoo: "entertainment",
  theme_park: "entertainment",
  aquarium: "entertainment",
  water_park: "entertainment",
  concert_hall: "entertainment",
  arena: "entertainment",
  casino: "entertainment",
  nightclub: "entertainment",
  mall: "shopping",
  supermarket: "shopping",
  marketplace: "shopping",
  department_store: "shopping",
  market: "shopping",
  viewpoint: "viewpoint",
};

export function categoryFromOsmValue(value?: string | null): PlaceCategory {
  if (!value) return "other";
  return OSM_VALUE_TO_CATEGORY[value.toLowerCase()] ?? "other";
}
