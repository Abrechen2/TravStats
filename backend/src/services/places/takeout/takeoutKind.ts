import type { TakeoutKind, TakeoutTreatment } from "../../../schemas/placeImportResolve";

/**
 * What kind of thing a saved Maps row is (#358, point 4).
 *
 * A Takeout list holds what someone saved, and that is not only sights: the
 * station they changed trains at, the fuel stop, the supermarket, the airport,
 * the hotel. Those read better as trip stops (or as the stay they already are)
 * than as places, and a saved city is usually a bookmark, not a visit. The kind
 * only decides the SUGGESTION — the preview shows it and the user picks.
 *
 * Read from Google's types where the CID lookup gave them, from Photon's OSM
 * value where the name search did, else from the name. Unknown is `sight`: the
 * row stays what the import always made of it.
 */

const GOOGLE_PRIORITY: ReadonlyArray<[TakeoutKind, (t: string) => boolean]> = [
  ["airport", (t) => t === "airport"],
  [
    "station",
    (t) =>
      [
        "train_station",
        "transit_station",
        "subway_station",
        "bus_station",
        "light_rail_station",
      ].includes(t),
  ],
  ["fuel", (t) => t === "gas_station" || t === "electric_vehicle_charging_station"],
  [
    "lodging",
    (t) =>
      ["lodging", "hotel", "motel", "hostel", "campground", "rv_park", "resort_hotel"].includes(t),
  ],
];

/** Types that make a whole settlement or region, not a spot in it. */
const AREA_TYPES = new Set([
  "locality",
  "sublocality",
  "postal_town",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "country",
  "political",
  "colloquial_area",
]);

const SHOP_TYPES = new Set([
  "store",
  "supermarket",
  "grocery_or_supermarket",
  "shopping_mall",
  "convenience_store",
  "department_store",
]);

function fromGoogleTypes(types: readonly string[]): TakeoutKind | null {
  if (types.length === 0) return null;
  for (const [kind, test] of GOOGLE_PRIORITY) if (types.some(test)) return kind;
  // Only the FIRST type decides "city" and "shop": a museum lists `political`
  // through its address and a cathedral may carry `store` for its gift shop.
  const first = types[0];
  if (AREA_TYPES.has(first)) return "city";
  if (SHOP_TYPES.has(first) || first.endsWith("_store")) return "shop";
  return "sight";
}

const OSM_KIND: Readonly<Record<string, TakeoutKind>> = {
  aerodrome: "airport",
  airport: "airport",
  station: "station",
  halt: "station",
  bus_station: "station",
  train_station: "station",
  fuel: "fuel",
  charging_station: "fuel",
  hotel: "lodging",
  hostel: "lodging",
  motel: "lodging",
  guest_house: "lodging",
  camp_site: "lodging",
  caravan_site: "lodging",
  city: "city",
  town: "city",
  village: "city",
  municipality: "city",
  county: "city",
  state: "city",
  country: "city",
  supermarket: "shop",
  mall: "shop",
  department_store: "shop",
  convenience: "shop",
};

const NAME_PATTERNS: ReadonlyArray<[TakeoutKind, RegExp]> = [
  ["airport", /\b(airport|flughafen|aeroporto|a[ée]roport|aeropuerto|lufthavn|flygplats)\b/i],
  ["fuel", /\b(tankstelle|gas station|petrol station|fuel|circle k|uno-x)\b/i],
  [
    "station",
    /\b(bahnhof|hbf|hauptbahnhof|busbahnhof|train station|railway station|stazione|gare|estaci[oó]n|stasjon|station)\b/i,
  ],
  [
    "lodging",
    /\b(hotel|hostel|motel|ryokan|guesthouse|g[äa]stehaus|pension|campingplatz|camping|campground)\b/i,
  ],
  ["shop", /\b(supermarkt|supermarket|einkaufszentrum|shopping mall|outlet)\b/i],
];

function fromName(name: string): TakeoutKind | null {
  for (const [kind, pattern] of NAME_PATTERNS) if (pattern.test(name)) return kind;
  return null;
}

export interface KindEvidence {
  name: string;
  googleTypes?: readonly string[] | null;
  osmType?: string | null;
}

export function classifyTakeoutKind(e: KindEvidence): TakeoutKind {
  const google = e.googleTypes ? fromGoogleTypes(e.googleTypes) : null;
  if (google && google !== "sight") return google;
  const osm = e.osmType ? (OSM_KIND[e.osmType] ?? null) : null;
  if (osm) return osm;
  return fromName(e.name) ?? google ?? "sight";
}

/**
 * The treatment the preview pre-selects. A trip stop needs a trip, so without
 * one a station is offered as a place again — the user can still skip it. A
 * hotel becomes "your stay" only where a stay at that spot was actually found.
 */
export function suggestTreatment(
  kind: TakeoutKind,
  ctx: { hasTrip: boolean; hasMatchedStay: boolean }
): TakeoutTreatment {
  if (kind === "city") return "skip";
  if (kind === "lodging" && ctx.hasMatchedStay) return "stay";
  if (kind === "sight") return "place";
  return ctx.hasTrip ? "trip_stop" : "place";
}
