/**
 * What a lodging row is still missing.
 *
 * The flight badges (`DataSourceBadges`) answer a different question — where a
 * row CAME FROM. This answers what it still needs, which is the question a
 * table full of imported houses actually raises.
 *
 * The set is deliberately small and was chosen by measuring a real 291-row
 * list rather than by imagining what could be absent:
 *
 *   20  an address, but no pin   — the geocoder did not find it
 *    5  no address at all
 *    1  a name and nothing else
 *    1  no city, 1 no country
 *
 * "Not found" and "nothing to find with" are the same missing pin but not the
 * same problem: one is a retry, the other is data entry. Telling them apart is
 * the whole reason this is a state and not a boolean.
 */
import type { Lodging } from "../../types/lodging";
import { resolveCountryCode } from "../../lib/countryFlag";

export type LodgingIssue =
  /** Address present, coordinates absent — geocoding failed or never ran. */
  | "unlocated"
  /** No street address; the pin may still be there from a search or a drop. */
  | "noAddress"
  /** Nothing but a name — neither address nor city nor pin. */
  | "bare"
  /** A country nobody can turn into a flag: junk, a town name, a typo. */
  | "unknownCountry";

const leer = (s: string | null | undefined): boolean => (s ?? "").trim().length === 0;

/**
 * The ONE issue worth showing, or null when the row is fine.
 *
 * One tag, not a row of them: a table column has room for a state, not for a
 * list, and a row carrying three warnings still needs the same single visit to
 * fix. The order below is the order in which they block the user — a bare row
 * cannot be geocoded, so saying "not found" about it would be misleading.
 *
 * A complete row returns null and renders NOTHING. 267 of 291 rows are
 * complete; a green "OK" on every one of them is noise that makes the 24 that
 * matter harder to see, not easier.
 */
export function lodgingIssue(lodging: Lodging): LodgingIssue | null {
  const hatPin = lodging.lat != null && lodging.lon != null;
  const hatAdresse = !leer(lodging.address);
  const hatOrt = !leer(lodging.city);

  if (!hatPin && !hatAdresse && !hatOrt) return "bare";
  if (hatAdresse && !hatPin) return "unlocated";
  if (!hatAdresse) return "noAddress";
  // Only worth saying once the row is otherwise sound: a country that resolves
  // to no ISO code shows no flag, and the user cannot tell whether the flag is
  // missing or the value is wrong. `resolveCountryCode` understands the name in
  // any language, so a miss here really is a bad value — "Fohnsdorf", a town
  // somebody's export wrote into the country column.
  if (!leer(lodging.country) && resolveCountryCode(lodging.country) === null) {
    return "unknownCountry";
  }
  return null;
}

/** Icon per issue. State is never carried by colour alone (BRAND.md). */
export const LODGING_ISSUE_ICON: Record<LodgingIssue, string> = {
  unlocated: "📍",
  noAddress: "🏷",
  bare: "❔",
  unknownCountry: "🏳",
};
