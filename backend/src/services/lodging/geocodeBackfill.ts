import { prisma } from "../../db";
import logger from "../../utils/logger";
import { geocodeAddress, reverseGeocode } from "../geo/nominatim";
import { searchPlaces } from "../geo/photon";
import { findLodgingPlace } from "../geo/googlePlaces";

/** A guardrail, not a policy: a single pass never walks more than this many rows. */
export const MAX_BACKFILL_ROWS = 500;

export interface BackfillResult {
  attempted: number;
  filled: number;
}

/** The lodging fields a coordinate lookup can work from. */
interface GeocodeSubject {
  name: string;
  type: string;
  address: string | null;
  city: string | null;
  country: string | null;
}

/**
 * OSM place kinds that are somewhere to sleep. Photon answers with the raw
 * `osm_value`, and anything outside this set is NOT the hotel we asked for.
 *
 * Measured on 30 of the owner's real names: of 21 Photon answers, 7 were a
 * charging station, a restaurant, a locality or a sawmill — "Thon Hotel Halden"
 * came back as `charging_station`. Stored unchecked, those are pins that look
 * right and are wrong, which is worse than an empty map.
 */
const OSM_LODGING_VALUES = new Set([
  "hotel",
  "hostel",
  "guest_house",
  "motel",
  "apartment",
  "chalet",
  "camp_site",
  "caravan_site",
  "camp_pitch",
  "alpine_hut",
  "wilderness_hut",
]);

/** Where a resolved position came from, so the caller can log it honestly. */
export type CoordinateSource = "photon" | "nominatim" | "google";

export interface ResolvedCoordinates {
  lat: number;
  lon: number;
  source: CoordinateSource;
  /** Only Google reports what KIND of place it found; the others cannot. */
  type?: string;
  city?: string | null;
  country?: string | null;
  address?: string | null;
}

/**
 * Find coordinates for one lodging: Photon, then Nominatim, then Google Places
 * if — and only if — an admin has entered a key.
 *
 * The order is deliberate. Photon is keyless, fuzzy and name-first, which is
 * what a saved-places list needs, and it has no per-second policy. Nominatim
 * answers structured addresses the others may miss. Google is last because it
 * is the only tier that costs money and leaves the open-data world; it is also
 * the only one that knows a hotel by its business name, which is why an
 * instance that wants precision can switch it on.
 *
 * Never throws — every tier degrades to "no answer" internally.
 */
async function resolveCoordinates(
  row: GeocodeSubject,
): Promise<ResolvedCoordinates | null> {
  const query = [row.name, row.city, row.country].filter(Boolean).join(", ");

  const [best] = await searchPlaces(query, { limit: 1 });
  // A hit is only usable when it IS a lodging. Photon does not always report a
  // type; an unknown one is treated as unusable rather than assumed good.
  if (best && best.type && OSM_LODGING_VALUES.has(best.type)) {
    return { lat: best.lat, lon: best.lon, source: "photon" };
  }

  const nominatim = await geocodeAddress({
    name: row.name,
    address: row.address,
    city: row.city,
    country: row.country,
  });
  if (nominatim) return { lat: nominatim.lat, lon: nominatim.lon, source: "nominatim" };

  const google = await findLodgingPlace(query);
  if (google) {
    return {
      lat: google.lat,
      lon: google.lon,
      source: "google",
      type: google.type,
      city: google.city,
      country: google.country,
      address: google.address,
    };
  }

  return null;
}

/**
 * Fill in coordinates for lodgings that have none, AFTER the import has already
 * committed (spec §3.1). Nominatim allows 1 req/s, so 232 rows would stall a
 * commit for ~4 minutes — unacceptable. A row without coordinates is valid data;
 * it simply has no map pin until this pass reaches it.
 *
 * `geocodeAddress` is already serialized + throttled process-wide, so this loop
 * must stay sequential — firing them in parallel would only queue behind the
 * same 1 req/s chain while holding N promises open.
 *
 * Every query is scoped to `userId` (and optionally `batchId`, itself always
 * ANDed with `userId`) so a caller can never backfill — or even discover the
 * existence of — another user's rows by passing someone else's batch id.
 *
 * Never throws: it is fire-and-forget from the commit route.
 */
export async function backfillMissingCoordinates(
  userId: string,
  batchId?: string,
): Promise<BackfillResult> {
  let attempted = 0;
  let filled = 0;

  try {
    const rows = await prisma.lodging.findMany({
      where: {
        userId,
        ...(batchId ? { batchId } : {}),
        OR: [{ lat: null }, { lon: null }],
      },
      // `name` is NOT NULL on this table, so every row has something to search
      // for. The old filter demanded a city or an address and therefore skipped
      // exactly the rows a parsed booking confirmation produces — hotel name,
      // no street — which is how an e-mail import ended up with no pin at all.
      select: { id: true, name: true, type: true, address: true, city: true, country: true },
      orderBy: { createdAt: "asc" },
      take: MAX_BACKFILL_ROWS,
    });

    for (const row of rows) {
      attempted++;
      try {
        const coords = await resolveCoordinates(row);
        if (!coords) continue;
        await prisma.lodging.update({
          where: { id: row.id },
          data: {
            lat: coords.lat,
            lon: coords.lon,
            // Only ever FILLS gaps: a value the user typed is never overwritten
            // by a lookup, and only Google reports a kind at all.
            ...(coords.type && coords.type !== row.type ? { type: coords.type } : {}),
            ...(coords.city && !row.city ? { city: coords.city } : {}),
            ...(coords.country && !row.country ? { country: coords.country } : {}),
            ...(coords.address && !row.address ? { address: coords.address } : {}),
          },
        });
        filled++;
      } catch (err) {
        logger.warn(
          {
            operation: "lodging_geocode_backfill_row_failed",
            lodgingId: row.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "Geocode backfill row failed — continuing",
        );
      }
    }

    logger.info(
      {
        operation: "lodging_geocode_backfill",
        userId,
        batchId,
        attempted,
        filled,
      },
      "Lodging geocode backfill finished",
    );
  } catch (err) {
    logger.error(
      {
        operation: "lodging_geocode_backfill_failed",
        userId,
        batchId,
        err: err instanceof Error ? err.message : String(err),
      },
      "Lodging geocode backfill failed",
    );
  }

  return { attempted, filled };
}

/**
 * The opposite pass: rows that HAVE a pin but no address text.
 *
 * A lodging entered by dropping a map pin or pasting coordinates is located
 * but not described — it has no city to group by, no country flag and nothing
 * to search for by name of place. The owner's rule is that every input method
 * ends with a complete location, so the pin-first methods need this pass the
 * same way the address-first ones need the forward one.
 *
 * Only ever FILLS empty fields; a value the user typed is never replaced.
 * Same constraints as the forward pass: sequential (shared 1 req/s budget),
 * user-scoped, bounded, never throws.
 */
export async function completeMissingAddresses(
  userId: string,
  batchId?: string,
): Promise<BackfillResult> {
  let attempted = 0;
  let filled = 0;

  try {
    const rows = await prisma.lodging.findMany({
      where: {
        userId,
        ...(batchId ? { batchId } : {}),
        lat: { not: null },
        lon: { not: null },
        OR: [{ address: null }, { city: null }, { country: null }],
      },
      select: { id: true, lat: true, lon: true, address: true, city: true, country: true },
      orderBy: { createdAt: "asc" },
      take: MAX_BACKFILL_ROWS,
    });

    for (const row of rows) {
      attempted++;
      try {
        // The WHERE guarantees both are non-null; narrow for TypeScript.
        if (row.lat === null || row.lon === null) continue;
        const parts = await reverseGeocode(row.lat, row.lon);
        if (!parts) continue;

        const data: { address?: string; city?: string; country?: string } = {};
        if (!row.address?.trim() && parts.address) data.address = parts.address;
        if (!row.city?.trim() && parts.city) data.city = parts.city;
        if (!row.country?.trim() && parts.country) data.country = parts.country;
        if (Object.keys(data).length === 0) continue;

        await prisma.lodging.update({ where: { id: row.id }, data });
        filled++;
      } catch (err) {
        logger.warn(
          {
            operation: "lodging_address_backfill_row_failed",
            lodgingId: row.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "Address backfill row failed — continuing",
        );
      }
    }

    logger.info(
      { operation: "lodging_address_backfill", userId, batchId, attempted, filled },
      "Lodging address backfill finished",
    );
  } catch (err) {
    logger.error(
      {
        operation: "lodging_address_backfill_failed",
        userId,
        batchId,
        err: err instanceof Error ? err.message : String(err),
      },
      "Lodging address backfill failed",
    );
  }

  return { attempted, filled };
}

/**
 * Both directions for one user — the retry net behind the owner's "always try,
 * whatever the input method" rule.
 *
 * A save resolves what it can synchronously; anything the geocoder could not
 * answer at that moment (it was down, rate-limiting, or the address was
 * ambiguous) lands here instead of being lost. Forward runs first so a row that
 * gains coordinates in this very pass can have its address completed by the
 * reverse pass immediately after.
 */
export async function backfillLodgingLocations(
  userId: string,
  batchId?: string,
): Promise<{ coordinates: BackfillResult; addresses: BackfillResult }> {
  const coordinates = await backfillMissingCoordinates(userId, batchId);
  const addresses = await completeMissingAddresses(userId, batchId);
  return { coordinates, addresses };
}

/**
 * Boot sweep across every user who owns an incomplete lodging.
 *
 * Without this, a row is only ever retried when someone happens to edit it:
 * the import path covers its own batch and a save covers its own row, but a
 * hand-created lodging whose first geocode failed had no path back. Since the
 * rule is that a location is ALWAYS attempted, there has to be something that
 * revisits what the synchronous attempts could not answer.
 *
 * Deliberately fire-and-forget and unawaited by the caller: at 1 req/s this
 * can run for minutes, and boot must not wait for it. Each user is capped at
 * MAX_BACKFILL_ROWS per pass, so a large install converges over several
 * restarts rather than hammering Nominatim once.
 */
export async function backfillAllLodgingLocations(): Promise<{
  users: number;
  coordinatesFilled: number;
  addressesFilled: number;
}> {
  let users = 0;
  let coordinatesFilled = 0;
  let addressesFilled = 0;

  try {
    // One grouped query rather than "all users" — an install where nobody uses
    // the lodging domain must do no work at all here.
    const incomplete = await prisma.lodging.findMany({
      where: {
        OR: [
          { lat: null },
          { lon: null },
          { address: null },
          { city: null },
          { country: null },
        ],
      },
      select: { userId: true },
      distinct: ["userId"],
    });

    for (const { userId } of incomplete) {
      users++;
      const result = await backfillLodgingLocations(userId);
      coordinatesFilled += result.coordinates.filled;
      addressesFilled += result.addresses.filled;
    }

    if (coordinatesFilled + addressesFilled > 0) {
      logger.info(
        {
          operation: "lodging_location_boot_backfill",
          users,
          coordinatesFilled,
          addressesFilled,
        },
        "Lodging location boot backfill finished",
      );
    }
  } catch (err) {
    logger.error(
      {
        operation: "lodging_location_boot_backfill_failed",
        err: err instanceof Error ? err.message : String(err),
      },
      "Lodging location boot backfill failed",
    );
  }

  return { users, coordinatesFilled, addressesFilled };
}
