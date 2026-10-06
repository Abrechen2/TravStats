import { PLACE_RANK, placeImportance, type PlaceKind } from "../placeImportance";

const { HIGH, MIDDLE, DEFAULT, LOW } = PLACE_RANK;

/**
 * The truth table behind the order of `/geo/reverse-places` (forgejo#209).
 * Each row is a tag Photon actually sends; the Gyeongbokgung rows are copied
 * from a live answer (2026-10-06).
 */
const TABLE: ReadonlyArray<[string, PlaceKind, number]> = [
  // High: sights, stations, the town
  ["a palace (tourism=attraction)", { osmKey: "tourism", osmValue: "attraction" }, HIGH],
  ["any historic tag", { osmKey: "historic", osmValue: "archaeological_site" }, HIGH],
  ["historic building", { osmKey: "historic", osmValue: "building", type: "house" }, HIGH],
  ["a museum", { osmKey: "tourism", osmValue: "museum" }, HIGH],
  ["a viewpoint", { osmKey: "tourism", osmValue: "viewpoint" }, HIGH],
  ["a zoo", { osmKey: "tourism", osmValue: "zoo" }, HIGH],
  ["a theme park", { osmKey: "tourism", osmValue: "theme_park" }, HIGH],
  ["a railway station", { osmKey: "railway", osmValue: "station" }, HIGH],
  ["an airport", { osmKey: "aeroway", osmValue: "aerodrome" }, HIGH],
  ["a church", { osmKey: "amenity", osmValue: "place_of_worship" }, HIGH],
  ["a university", { osmKey: "amenity", osmValue: "university" }, HIGH],
  ["a park", { osmKey: "leisure", osmValue: "park" }, HIGH],
  ["a stadium", { osmKey: "leisure", osmValue: "stadium" }, HIGH],
  ["a city", { osmKey: "place", osmValue: "city", type: "city" }, HIGH],
  ["a town", { osmKey: "place", osmValue: "town" }, HIGH],
  ["a suburb", { osmKey: "place", osmValue: "suburb", type: "district" }, HIGH],
  [
    "a boundary Photon calls a city",
    { osmKey: "boundary", osmValue: "administrative", type: "city" },
    HIGH,
  ],
  ["case and padding do not matter", { osmKey: " Tourism ", osmValue: "MUSEUM" }, HIGH],

  // Middle: places one goes to on purpose
  ["a hotel", { osmKey: "tourism", osmValue: "hotel" }, MIDDLE],
  ["a restaurant", { osmKey: "amenity", osmValue: "restaurant" }, MIDDLE],
  ["a cafe", { osmKey: "amenity", osmValue: "cafe" }, MIDDLE],
  ["a mall", { osmKey: "shop", osmValue: "mall" }, MIDDLE],
  ["a department store", { osmKey: "shop", osmValue: "department_store" }, MIDDLE],
  ["a pond (natural/water)", { osmKey: "natural", osmValue: "water" }, MIDDLE],

  // Default: tagged, but not named anywhere above
  ["a ranger station", { osmKey: "amenity", osmValue: "ranger_station" }, DEFAULT],
  ["a pond (water=pond)", { osmKey: "water", osmValue: "pond", type: "other" }, DEFAULT],
  ["a construction site", { osmKey: "landuse", osmValue: "construction" }, DEFAULT],
  ["a legal district", { osmKey: "boundary", osmValue: "legal", type: "other" }, DEFAULT],
  [
    "a district boundary",
    { osmKey: "boundary", osmValue: "administrative", type: "district" },
    DEFAULT,
  ],
  ["an unknown tourism value", { osmKey: "tourism", osmValue: "picnic_site" }, DEFAULT],
  ["no tags at all", {}, DEFAULT],
  ["Photon's house type alone", { type: "house" }, DEFAULT],

  // Low: street furniture, small shops, buildings, addresses
  ["a bus stop", { osmKey: "highway", osmValue: "bus_stop" }, LOW],
  ["a street", { osmKey: "highway", osmValue: "tertiary", type: "street" }, LOW],
  ["a stationery shop", { osmKey: "shop", osmValue: "stationery" }, LOW],
  ["a souvenir shop", { osmKey: "shop", osmValue: "gift" }, LOW],
  ["an ATM", { osmKey: "amenity", osmValue: "atm" }, LOW],
  ["toilets", { osmKey: "amenity", osmValue: "toilets" }, LOW],
  ["an entrance", { osmKey: "entrance", osmValue: "main" }, LOW],
  ["a plain building", { osmKey: "building", osmValue: "yes", type: "house" }, LOW],
  ["a house", { osmKey: "building", osmValue: "house" }, LOW],
  ["a postcode", { osmKey: "place", osmValue: "postcode", type: "other" }, LOW],
  ["an untagged street", { type: "street" }, LOW],
];

describe("placeImportance", () => {
  it.each(TABLE)("%s", (_label, kind, expected) => {
    expect(placeImportance(kind)).toBe(expected);
  });

  it("orders the tiers high > middle > default > low", () => {
    expect(HIGH).toBeGreaterThan(MIDDLE);
    expect(MIDDLE).toBeGreaterThan(DEFAULT);
    expect(DEFAULT).toBeGreaterThan(LOW);
  });
});
