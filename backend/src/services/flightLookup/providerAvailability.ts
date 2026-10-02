import { getApiKey, getOpenSkyCredentials } from "../apiKeyResolver";

/**
 * Which flight-data providers this user can reach, as the two questions a
 * lookup asks before it spends a request.
 *
 * `any`: is anything configured at all? Without a single provider, "this date
 * needs Aviationstack or AeroDataBox" would be the wrong answer, because it
 * implies the free providers are set up and merely limited.
 *
 * `byDate`: can anything answer for a day other than today? AirLabs lies about
 * non-today dates and OpenSky has no working callsign-by-date endpoint, so
 * only Aviationstack, AeroDataBox (≤ 365 days back, near-future schedules) and
 * FlightAware AeroAPI (ten days back, two ahead) count.
 *
 * Moved out of `flightLookup.ts` when AeroAPI joined both lists (forgejo#156):
 * that file is frozen at its size by the file-size ratchet.
 */
export async function flightProviderAvailability(
  userId?: string
): Promise<{ any: boolean; byDate: boolean }> {
  const [airlabs, aviationstack, aerodatabox, aeroapi, openSky] = await Promise.all([
    getApiKey("airlabs", userId),
    getApiKey("aviationstack", userId),
    getApiKey("aerodatabox", userId),
    getApiKey("aeroapi", userId),
    getOpenSkyCredentials(userId),
  ]);
  const byDate = Boolean(aviationstack || aerodatabox || aeroapi);
  return { any: byDate || Boolean(airlabs || openSky), byDate };
}
