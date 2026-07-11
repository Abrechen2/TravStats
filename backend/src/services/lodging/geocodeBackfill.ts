import { prisma } from "../../db";
import logger from "../../utils/logger";
import { geocodeAddress } from "../geo/nominatim";

/** A guardrail, not a policy: a single pass never walks more than this many rows. */
export const MAX_BACKFILL_ROWS = 500;

export interface BackfillResult {
  attempted: number;
  filled: number;
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
        // Nothing to geocode without at least a city or an address.
        NOT: [{ city: null, address: null }],
      },
      select: { id: true, address: true, city: true, country: true },
      orderBy: { createdAt: "asc" },
      take: MAX_BACKFILL_ROWS,
    });

    for (const row of rows) {
      attempted++;
      try {
        const coords = await geocodeAddress({
          address: row.address,
          city: row.city,
          country: row.country,
        });
        if (!coords) continue;
        await prisma.lodging.update({
          where: { id: row.id },
          data: { lat: coords.lat, lon: coords.lon },
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
