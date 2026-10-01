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
