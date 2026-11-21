import { getCountryResolver } from "../geo/countryFromCoordinates";
import { resolveCountryCode } from "../../shared/geo/countryCode";
import { prisma } from "../../db";
import logger from "../../utils/logger";

/**
 * Why a lodging's position needs a look. Stored in `lodgings.location_check`
 * as the bare code; the UI maps it to DE/EN copy (`lodging.locationCheck.*`).
 *
 * A geocoder answer that contradicts what the record already says is NOT
 * written to lat/lon — the record stays unlocated and names the reason here.
 * GitHub #401: "Tulip Inn Wolfenbuettel" sat near Delhi because a name-only
 * search found the Indian "Tulip Inn", and the reverse lookup of that pin then
 * stamped the address "Indien" onto the row.
 */
export const LOCATION_CHECK = {
  /** Nothing but a name is known; a name is not a place, so no hit is applied. */
  nameOnly: "name_only",
  /** Every hit lay in a different country/city than the record states. */
  contradicted: "contradicted",
  /** The geocoder could not be asked or did not answer — NOT "no such place". */
  providerUnavailable: "provider_unavailable",
  /** The geocoder answered and found nothing usable. */
  noResult: "no_result",
  /** The stored pin lies in another country than the stored country. */
  pinCountryMismatch: "pin_country_mismatch",
  /** The user looked and the position stands. Never flagged again by a sweep. */
  reviewed: "reviewed",
} as const;

export type LocationCheck = (typeof LOCATION_CHECK)[keyof typeof LOCATION_CHECK];

/** Is there anything that says WHERE the record is — a street, a town or a country? */
export function hasPlaceMaterial(row: {
  address?: string | null;
  city?: string | null;
  country?: string | null;
}): boolean {
  return [row.address, row.city, row.country].some((v) => (v ?? "").trim().length > 0);
}

export interface PinContradictionResult {
  /** Rows looked at: pinned, with a country that resolves to a code. */
  checked: number;
  /** Rows newly flagged `pin_country_mismatch`. */
  flagged: number;
}

/**
 * The one-off detector for data written before the guard existed: a lodging
 * whose pin lies in another country than its stored country. Offline (the
 * vendored country outlines), so it costs no geocoder request.
 *
 * It FLAGS and never rewrites — which of the two is right is the owner's call.
 * It only sets the flag on rows that carry none, so a code the geocoder wrote
 * is not replaced, and a row the user has since fixed is not re-flagged until
 * the next run finds it contradicting again. A point the outlines cannot place
 * (open water, a microstate) says nothing and is skipped, not flagged.
 *
 * Limit, stated: when the country itself was filled from the wrong pin (the
 * #401 row reads "Indien" next to a pin in India) the two agree and nothing
 * here can tell. That needs the name or the booking as evidence.
 */
export async function flagPinCountryContradictions(
  userId?: string
): Promise<PinContradictionResult> {
  const result: PinContradictionResult = { checked: 0, flagged: 0 };
  try {
    const resolver = await getCountryResolver();
    const rows = await prisma.lodging.findMany({
      where: {
        ...(userId ? { userId } : {}),
        lat: { not: null },
        lon: { not: null },
        country: { not: null },
        locationCheck: null,
      },
      select: { id: true, lat: true, lon: true, country: true, isoCountryCode: true },
    });
    for (const row of rows) {
      if (row.lat === null || row.lon === null) continue;
      const stated = row.isoCountryCode ?? resolveCountryCode(row.country);
      if (!stated) continue;
      const pinned = resolver.countryAt(row.lat, row.lon);
      if (!pinned) continue;
      result.checked++;
      if (pinned === stated.toUpperCase()) continue;
      // share-exempt: a review marker is account-local, never a fact of the house
      const written = await prisma.lodging.updateMany({
        // Conditional on the row still being what was read: a user who moved
        // the pin meanwhile must not be flagged for the old one.
        where: {
          id: row.id,
          lat: row.lat,
          lon: row.lon,
          country: row.country,
          locationCheck: null,
        },
        data: { locationCheck: LOCATION_CHECK.pinCountryMismatch },
      });
      result.flagged += written.count;
    }
    if (result.flagged > 0) {
      logger.info(
        { operation: "lodging_pin_country_flagged", ...result },
        "Lodgings whose pin contradicts their country were flagged for review"
      );
    }
  } catch (err) {
    logger.error(
      {
        operation: "lodging_pin_country_flag_failed",
        err: err instanceof Error ? err.message : String(err),
      },
      "Pin/country contradiction sweep failed"
    );
  }
  return result;
}
