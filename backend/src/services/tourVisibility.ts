import { getInstanceSettings } from "./instanceSettingsService";

/**
 * Whether day tours may be shown at all — the server's half of the web's
 * `useToursVisible` (coordinator ruling 2026-10-09, one rule everywhere):
 * the instance's beta switch for the `roadtrips` key and nothing else.
 *
 * Tours are not a domain. The roadtrip DOMAIN toggle is a user's choice about
 * roadtrips; it is not consulted for tours, on the web or here. Every server
 * figure that would put a tour on screen — the cruise excursions, the year in
 * review's tour chapter, the tour badges — asks this.
 */
export async function toursVisible(): Promise<boolean> {
  return (await getInstanceSettings()).betaFeaturesEnabled;
}
