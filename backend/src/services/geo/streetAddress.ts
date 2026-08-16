/**
 * Street and house number, in the order the country writes them.
 *
 * Both geocoders used to join them German-style and unconditionally —
 * `${street} ${housenumber}` in photon, `[road, houseNumber].join(" ")` in
 * nominatim. That is right for Germany and wrong for most of the
 * English-speaking world. Found on the owner's data: "Hotel Rose" in Portland
 * was stored as "Southwest Morrison Street 50", along with four more US
 * addresses in the same shape.
 */

/**
 * Countries that write the house number BEFORE the street.
 *
 * Deliberately a list of the clear cases rather than a guess at every country:
 * the fallback is street-first, which is what most of Europe uses and what both
 * geocoders already did, so an unlisted country keeps today's behaviour instead
 * of acquiring a new kind of wrong.
 *
 * Japan is left out on purpose — its addressing is not "number and street" at
 * all, and reordering two fields cannot express it.
 */
const NUMBER_FIRST_COUNTRIES = new Set([
  "us", // United States
  "ca", // Canada
  "gb", // United Kingdom
  "ie", // Ireland
  "au", // Australia
  "nz", // New Zealand
  "fr", // France
  "in", // India
  "za", // South Africa
  "sg", // Singapore
  "my", // Malaysia
  "th", // Thailand
  "ph", // Philippines
  "il", // Israel
  "hk", // Hong Kong
]);

/**
 * @param street the road name, without a number
 * @param houseNumber the number, when the source carried one
 * @param countryCode ISO 3166-1 alpha-2, any case; unknown falls back to street-first
 * @returns the formatted line, or undefined when there is no street to build on
 */
export function formatStreetAddress(
  street: string | null | undefined,
  houseNumber: string | null | undefined,
  countryCode: string | null | undefined,
): string | undefined {
  // A bare house number is not an address — it names nothing on its own.
  if (!street) return undefined;
  if (!houseNumber) return street;

  const code = (countryCode ?? "").trim().toLowerCase();
  return NUMBER_FIRST_COUNTRIES.has(code) ? `${houseNumber} ${street}` : `${street} ${houseNumber}`;
}
