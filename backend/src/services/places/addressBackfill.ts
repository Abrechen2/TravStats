/**
 * Places get their address from their pin.
 *
 * A place almost never arrives with one. The two ways one is created both
 * produce a located but undescribed row:
 *
 *   - ticking a checklist item copies name, coordinates and (sometimes) a
 *     country out of `curated_places`, a table that has no address column at
 *     all — and carries a country name for only 14 of its 1261 rows, the
 *     hand-curated wonders. The 1247 World Heritage sites bring an ISO code
 *     and nothing else.
 *   - dropping a pin or pasting coordinates in the place form fills whatever
 *     the user typed, which is usually just a name.
 *
 * So the address is derived from the coordinates, exactly as lodging does it
 * (`services/lodging/geocodeBackfill.ts`). The actual reverse-geocoding and
 * the "fill only what is empty" rule live in `geo/completeAddressFromCoordinates`
 * and are NOT duplicated here — this module only decides which place rows to
 * feed it and writes the result back.
 *
 * Two properties inherited from that helper matter and must not be worked
 * around: it never overwrites a value the user supplied, and it resolves to
 * null rather than throwing, so a geocoder that is slow, rate-limited or down
 * can delay an address but never fail a save or a job.
 */

import { prisma } from "../../db";
import logger from "../../utils/logger";
import { completeAddressFromCoordinates } from "../geo/nominatim";
import { resolveCountryCode } from "../../shared/geo/countryCode";
import { anyNonLatin, hasNonLatinScript } from "../../shared/geo/latinScript";

/**
 * Upper bound per run. Nominatim is throttled to 1 request/second
 * process-wide, so this is also the wall-clock budget in seconds. Matches
 * lodging's MAX_BACKFILL_ROWS so neither domain can starve the other by
 * queueing an unbounded batch.
 */
export const MAX_PLACE_BACKFILL_ROWS = 500;

export interface PlaceBackfillResult {
  attempted: number;
  filled: number;
}

/** The columns the backfill reads and may write. */
const SELECT = { id: true, lat: true, lon: true, address: true, city: true, country: true } as const;

/**
 * Fill one place's empty location fields from its coordinates.
 *
 * Returns true when something was written. Safe to call on a row that is
 * already complete — it costs one cheap comparison and no request, because
 * `completeAddressFromCoordinates` returns null before reaching the network.
 */
export async function completePlaceAddress(placeId: string): Promise<boolean> {
  const row = await prisma.place.findUnique({ where: { id: placeId }, select: SELECT });
  if (!row) return false;
  return writeCompletion(row);
}

/**
 * Fill every place of one user that has a pin but no description.
 *
 * User-scoped and bounded, like the lodging pass. Runs sequentially because
 * the geocoder queue is sequential anyway — issuing them in parallel would
 * only build a longer queue, not a faster one.
 */
export async function completeMissingPlaceAddresses(
  userId: string,
  limit: number = MAX_PLACE_BACKFILL_ROWS,
): Promise<PlaceBackfillResult> {
  let attempted = 0;
  let filled = 0;

  try {
    // Two kinds of row need this pass: one that never got a description, and
    // one that got an UNREADABLE one. Until the geocoder was asked for `de,en`
    // it answered in the local language, so rows recorded earlier hold 日光市
    // and مصر — text the reader cannot read, sort or type. Those are refetched
    // rather than left, which is the one case where this pass overwrites
    // instead of filling. See `writeCompletion`.
    const rows = await prisma.place.findMany({
      where: { userId },
      select: SELECT,
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    const candidates = rows.filter(
      (r) =>
        r.address === null ||
        r.city === null ||
        r.country === null ||
        anyNonLatin(r.address, r.city, r.country),
    );

    for (const row of candidates) {
      attempted++;
      try {
        if (await writeCompletion(row)) filled++;
      } catch (err) {
        // One unreachable row must not abandon the rest of the batch.
        logger.warn(
          {
            operation: "place_address_backfill_row_failed",
            placeId: row.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "Place address backfill row failed — continuing",
        );
      }
    }

    logger.info(
      { operation: "place_address_backfill", userId, attempted, filled },
      "Place address backfill finished",
    );
  } catch (err) {
    logger.error(
      {
        operation: "place_address_backfill_failed",
        userId,
        err: err instanceof Error ? err.message : String(err),
      },
      "Place address backfill failed",
    );
  }

  return { attempted, filled };
}

/**
 * The shared middle step: ask the geo helper what is missing, write only that.
 *
 * `isoCountryCode` is kept in step with `country` here rather than left to the
 * caller, because a country name written without its code is exactly the state
 * that puts a place in no country filter and gives it no flag.
 */
async function writeCompletion(row: {
  id: string;
  lat: number;
  lon: number;
  address: string | null;
  city: string | null;
  country: string | null;
}): Promise<boolean> {
  // A field in a script the reader cannot read is treated as ABSENT, so the
  // geo helper — which only ever fills gaps — refetches it. That is the single
  // exception to "never overwrite what is stored", and it is narrow on
  // purpose: it applies to the script, never to the wording. "Lëtzebuerg" and
  // "Đà Nẵng" are Latin and therefore left exactly as they are.
  const readable = (v: string | null): string | null => (hasNonLatinScript(v) ? null : v);

  const filled = await completeAddressFromCoordinates({
    lat: row.lat,
    lon: row.lon,
    address: readable(row.address),
    city: readable(row.city),
    country: readable(row.country),
  });
  if (!filled) return false;

  const data: { address?: string; city?: string; country?: string; isoCountryCode?: string } = {};
  if (filled.address) data.address = filled.address;
  if (filled.city) data.city = filled.city;
  if (filled.country) {
    data.country = filled.country;
    const code = resolveCountryCode(filled.country);
    if (code) data.isoCountryCode = code;
  }
  if (Object.keys(data).length === 0) return false;

  await prisma.place.update({ where: { id: row.id }, data });
  return true;
}
