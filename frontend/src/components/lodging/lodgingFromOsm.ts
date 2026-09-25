import type { NearbyLodging } from "../../lib/api/openData";
import type { LodgingChain, LodgingType } from "../../types/lodging";

/** The lodging form's own vocabulary for an OSM `tourism` value; null where it has none. */
const TYPE_BY_KIND: Readonly<Record<string, LodgingType>> = {
  hotel: "hotel",
  motel: "hotel",
  guest_house: "guesthouse",
  alpine_hut: "guesthouse",
  hostel: "hostel",
  apartment: "apartment",
  chalet: "apartment",
  camp_site: "campsite",
  caravan_site: "campsite",
};

export function lodgingTypeForKind(kind: string): LodgingType | null {
  return TYPE_BY_KIND[kind] ?? null;
}

/** What the form holds of the fields a picked OSM house may fill. */
export interface OsmFillableFields {
  name: string;
  stars: string;
  website: string;
  chain: LodgingChain | null;
}

export type OsmFilledField = "name" | "stars" | "website" | "chain";

export interface OsmFill {
  patch: Partial<OsmFillableFields>;
  filled: OsmFilledField[];
}

/**
 * The fields a picked OpenStreetMap house fills — only those still empty. The
 * user picked the house, not its values: a name they typed or stars they set
 * are theirs, even when the map disagrees.
 */
export function osmFillFor(place: NearbyLodging, current: OsmFillableFields): OsmFill {
  const patch: Partial<OsmFillableFields> = {};
  const filled: OsmFilledField[] = [];
  if (current.name.trim() === "") {
    patch.name = place.name;
    filled.push("name");
  }
  if (current.stars.trim() === "" && place.stars !== null) {
    patch.stars = String(place.stars);
    filled.push("stars");
  }
  if (current.website.trim() === "" && place.website !== null) {
    patch.website = place.website;
    filled.push("website");
  }
  if (current.chain === null && place.chain !== null) {
    patch.chain = place.chain;
    filled.push("chain");
  }
  return { patch, filled };
}
