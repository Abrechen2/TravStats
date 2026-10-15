import type { PlaceCategory } from "../../../shared/placeCategories";

/** Explicit OSM venue types; ordinary shops and generic land use are excluded. */
export const VENUE_TYPES = ["market", "mall", "park", "zoo", "themePark", "museum"] as const;
export type VenueType = (typeof VENUE_TYPES)[number];
export function venueType(tags: Record<string, unknown>): VenueType | null {
  if (tags.amenity === "marketplace") return "market";
  if (tags.shop === "mall") return "mall";
  if (tags.tourism === "zoo") return "zoo";
  if (tags.tourism === "theme_park") return "themePark";
  if (tags.tourism === "museum") return "museum";
  if (tags.leisure === "park") return "park";
  const english = typeof tags["name:en"] === "string" ? tags["name:en"] : "";
  return /\bmarket\b/i.test(english) &&
    !tags.shop &&
    !tags.highway &&
    !tags.amenity &&
    (!!tags.landuse || !!tags.building)
    ? "market"
    : null;
}
export function venueCategory(type: VenueType): PlaceCategory {
  switch (type) {
    case "market":
    case "mall":
      return "shopping";
    case "park":
    case "zoo":
      return "nature";
    case "museum":
      return "museum";
    case "themePark":
      return "entertainment";
  }
}
/** A stroll through a park is weaker evidence than staying at a market. */
export function venueMinimumMinutes(type: VenueType): number {
  return type === "park" ? 15 : type === "market" ? 5 : 10;
}
