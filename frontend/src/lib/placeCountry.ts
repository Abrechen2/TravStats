/**
 * What country a place shows, in one place.
 *
 * A place can carry its country twice and usually carries it once: the
 * catalogue gives an ISO code to all 1261 of its entries and a country NAME to
 * only 14 of them, while a hand-entered place has whatever the user typed and
 * a code derived from it. Either half can therefore be the only one present.
 *
 * This lived as a private helper inside `PlacesListPage`, so the list resolved
 * the code into a name and the detail page — which did not have the helper —
 * printed a bare "—" next to the raw code. Same record, two answers. The
 * derivation belongs to the domain, not to one page.
 */

import { countryName, resolveCountryCode } from "../shared/geo/countryCode";

/** The two fields any country-bearing place row has. */
export interface PlaceCountryFields {
  country?: string | null;
  isoCountryCode?: string | null;
}

/**
 * The country as a reader should see it: a localised name wherever a code is
 * known, the stored text otherwise, and an empty string when there is neither.
 *
 * The code wins over the text on purpose. `Intl.DisplayNames` follows the app
 * language, so a code renders as "Australien" in German and "Australia" in
 * English, whereas the stored text is frozen in whatever language the source
 * wrote it in.
 */
export function placeCountryLabel(place: PlaceCountryFields, locale: string): string {
  if (place.isoCountryCode) {
    return countryName(place.isoCountryCode, locale) || place.isoCountryCode;
  }
  return place.country ?? "";
}

/**
 * The ISO code for a flag or a filter, from whichever half the row has.
 *
 * `FlagImg` already accepts a name and resolves it, but it draws NOTHING for a
 * blank one — which is why places holding only a code showed no flag: the call
 * sites guarded on `place.country` being truthy before rendering it at all.
 */
export function placeCountryCode(place: PlaceCountryFields): string | null {
  return place.isoCountryCode ?? resolveCountryCode(place.country ?? null);
}
