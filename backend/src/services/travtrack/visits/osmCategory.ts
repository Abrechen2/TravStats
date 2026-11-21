import type { PlaceCategory } from "../../../shared/placeCategories";

/**
 * The place category an OSM venue type stands for. A type this table does not
 * know is `other`: a category is a convenience on a new place, never a guess
 * the user has to undo.
 */
const BY_TYPE: Record<string, PlaceCategory> = {
  restaurant: "restaurant",
  cafe: "restaurant",
  fast_food: "restaurant",
  food_court: "restaurant",
  bar: "restaurant",
  pub: "restaurant",
  biergarten: "restaurant",
  ice_cream: "restaurant",
  bakery: "restaurant",
  supermarket: "shopping",
  convenience: "shopping",
  mall: "shopping",
  department_store: "shopping",
  clothes: "shopping",
  shop: "shopping",
  marketplace: "shopping",
  museum: "museum",
  gallery: "museum",
  cinema: "entertainment",
  theatre: "entertainment",
  theme_park: "entertainment",
  zoo: "entertainment",
  aquarium: "entertainment",
  attraction: "landmark",
  viewpoint: "viewpoint",
  park: "nature",
  nature_reserve: "nature",
  fuel: "service_area",
  charging_station: "service_area",
  parking: "service_area",
};

export function osmCategory(type: string | null | undefined): PlaceCategory {
  return (type && BY_TYPE[type.toLowerCase()]) || "other";
}
