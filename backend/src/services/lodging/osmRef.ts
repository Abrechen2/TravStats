/**
 * The OpenStreetMap identity a lodging form pick carries (2026-09-26).
 *
 * Picking a house from "lodgings nearby" filled its name, stars and website
 * but dropped the one thing that says WHICH house it was: the pick's
 * `osm:node/…` reference. It is stored in `externalRef`, under the same
 * fill-empty rule as the other fields — a reference the row already has (a
 * Google place id from an import, an earlier pick) is never replaced.
 *
 * `@@unique([userId, externalRef])` allows one row per house per account. A
 * pick of a house another lodging already carries is therefore not stored on
 * this one: the save goes through (the user's record matters more than the
 * link), and the conflict is logged rather than turned into a failed save.
 */

import { prisma } from "../../db";
import logger from "../../utils/logger";

/** The reference to write, or undefined to leave `externalRef` alone. */
export async function osmRefToStore(
  userId: string,
  osmRef: string | undefined,
  existing?: { id: string; externalRef: string | null }
): Promise<string | undefined> {
  if (!osmRef) return undefined;
  if (existing?.externalRef) return undefined;
  const holder = await prisma.lodging.findFirst({
    where: { userId, externalRef: osmRef, ...(existing ? { NOT: { id: existing.id } } : {}) },
    select: { id: true },
  });
  if (holder) {
    const operation = "lodging_osm_ref_taken";
    logger.info({ operation, userId, heldBy: holder.id, lodgingId: existing?.id ?? null });
    // The OSM reference names the hotel — detail for debug, not the info log.
    logger.debug({ operation, osmRef });
    return undefined;
  }
  return osmRef;
}
