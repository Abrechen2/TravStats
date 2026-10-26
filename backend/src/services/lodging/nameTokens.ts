/**
 * Words that sit in hotel names without saying WHICH house.
 *
 * Both lists are folded the way `nameSimilarity.ts` folds (lower case,
 * ä→ae …), because they are compared against its tokens.
 *
 * Found in prod on 2026-09-30: "Novotel Basel City" and "Hotel Krafft Basel"
 * were one house to the matcher because both contain "basel". A city, a
 * "City"/"Zentrum" suffix or a brand shared by dozens of hotels is not
 * identity; a house's own name is.
 */

/** Location decoration — tells where in a town, never which building. */
export const LOCATION_TOKENS: ReadonlySet<string> = new Set([
  "city",
  "centre",
  "center",
  "centrum",
  "zentrum",
  "mitte",
  "downtown",
  "central",
  "airport",
  "flughafen",
  "station",
  "bahnhof",
  "hbf",
]);

/**
 * Brands carried by many houses. Two Novotels in one city are two hotels, so
 * a brand alone never proves identity — coordinates can, the name cannot.
 * Keep in step with the chains in `chainFromWebsite.ts`.
 */
export const BRAND_TOKENS: ReadonlySet<string> = new Set([
  "novotel",
  "ibis",
  "mercure",
  "pullman",
  "sofitel",
  "swissotel",
  "mgallery",
  "adagio",
  "hilton",
  "conrad",
  "doubletree",
  "hampton",
  "marriott",
  "courtyard",
  "sheraton",
  "westin",
  "moxy",
  "radisson",
  "scandic",
  "melia",
  "hyatt",
  "intercontinental",
  "kempinski",
  "leonardo",
]);

/**
 * What a house looks at, or how it sells itself — words its neighbours carry
 * too. Beside a pin they never identify on their own: the OSM audit of
 * 2026-10-26 matched "PANORAMA view pyramids" to "Pyramids View Inn" 44 m
 * away, a different house. Used only where coordinates already proved the
 * neighbourhood (`nearby`), so an import's name matching is unchanged.
 */
export const LANDMARK_TOKENS: ReadonlySet<string> = new Set([
  "pyramid",
  "pyramids",
  "view",
  "views",
  "panorama",
  "panoramic",
  "beach",
  "sea",
  "lake",
  "river",
  "harbour",
  "harbor",
  "marina",
  "old",
  "town",
  "plaza",
  "square",
  "terminal",
  "grand",
  "royal",
  "boutique",
  "luxury",
  "inn",
  "suites",
  "apartments",
  "residence",
  "residences",
  "lodge",
  "guesthouse",
  "homestay",
  "jugendherberge",
  "youth",
]);
