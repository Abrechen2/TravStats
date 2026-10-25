/**
 * The explored map's zone raster (TravTrack plan L1; Codex review of
 * a3353f2a7): the zoom-14 tiles of every privacy zone in force and of the
 * newest former zones' circles, grouped into edge-connected components, in
 * `travtrack_zone_cells`. Rebuilt in the transaction of every zone change
 * (`zones.ts`), under the TravTrack lock; an account never built is built by
 * its first explored-map request. A request then reads a few bounded rows,
 * however many circles the account ever had.
 *
 * Former zones: the newest `MAX_FORMER_CIRCLES`, after dropping any circle
 * that lies inside another one (moving a zone back and forth leaves the same
 * circle many times). Older ones are not rasterised: their old hole is far
 * back in a history that has since been walked over, or not — a bounded
 * request is worth that. More than `MAX_ZONE_CELLS` in all fails closed.
 */
import { prisma, type DbTransaction } from "../../../db";
import logger from "../../../utils/logger";
import { distanceM, type ZoneCircle } from "../classify";
import { takeTravTrackLock } from "../lock";
import { cellKey, type Cell } from "./cells";
import { circleCells, zoneComponents } from "./zoneRaster";

/** Raised when the raster's rule changes; an account below it is rebuilt. */
export const ZONE_CELLS_VERSION = 1;
/** Former zones' circles rasterised at most (newest first). */
export const MAX_FORMER_CIRCLES = 100;
/**
 * Raster cells an account holds at most. Beyond it the raster is stored
 * EMPTY — fail-closed: no zone cell is drawn at all, the same answer as for
 * ground nobody walked, never a partial fill whose edge could outline a zone.
 */
export const MAX_ZONE_CELLS = 50_000;

type Db = Pick<
  DbTransaction,
  | "travTrackPrivacyZone"
  | "travTrackZoneTombstone"
  | "travTrackZoneCell"
  | "travTrackDerivationState"
>;

const inside = (a: ZoneCircle, b: ZoneCircle) => distanceM(a, b) + a.radiusM <= b.radiusM;

/** The zones in force, then the newest former circles not inside one already taken. */
async function circlesOf(db: Db, userId: string): Promise<ZoneCircle[]> {
  const select = { lat: true, lon: true, radiusM: true } as const;
  const zones = await db.travTrackPrivacyZone.findMany({ where: { userId }, select });
  const taken: ZoneCircle[] = zones.filter((z) => z.radiusM > 0);
  let former = 0;
  let skip = 0;
  // Paged newest first, so a long run of repeats does not end the search early.
  while (former < MAX_FORMER_CIRCLES) {
    const page = await db.travTrackZoneTombstone.findMany({
      where: { userId },
      orderBy: [{ untilAt: "desc" }, { id: "asc" }],
      select,
      skip,
      take: 200,
    });
    if (page.length === 0) break;
    skip += page.length;
    for (const c of page) {
      if (c.radiusM <= 0 || taken.some((t) => inside(c, t))) continue;
      taken.push(c);
      if (++former >= MAX_FORMER_CIRCLES) break;
    }
    if (skip >= 10 * MAX_FORMER_CIRCLES) break;
  }
  return taken;
}

/** Replaces the account's raster from its circles. Call inside the zone change's transaction. */
export async function rebuildZoneCells(tx: DbTransaction, userId: string): Promise<void> {
  const circles = await circlesOf(tx, userId);
  const cells = new Map<string, Cell>();
  for (const c of circles) for (const cell of circleCells(c)) cells.set(cellKey(cell), cell);
  const overflow = cells.size > MAX_ZONE_CELLS;
  if (overflow) {
    // Counts only: never a position.
    logger.warn({ operation: "travtrack.explored.zoneCellsOverflow", userId, cells: cells.size });
  }
  const rows = overflow
    ? []
    : zoneComponents(cells.values()).flatMap((component, i) =>
        component.map((c) => ({ userId, x: c.x, y: c.y, component: i }))
      );
  await tx.travTrackZoneCell.deleteMany({ where: { userId } });
  if (rows.length > 0) await tx.travTrackZoneCell.createMany({ data: rows });
  await tx.travTrackDerivationState.upsert({
    where: { userId },
    create: { userId, zoneCellsVersion: ZONE_CELLS_VERSION },
    update: { zoneCellsVersion: ZONE_CELLS_VERSION },
  });
}

/** Builds the raster once for an account that never had it (or an older rule). */
export async function ensureZoneCells(userId: string): Promise<void> {
  const state = await prisma.travTrackDerivationState.findUnique({
    where: { userId },
    select: { zoneCellsVersion: true },
  });
  if ((state?.zoneCellsVersion ?? 0) >= ZONE_CELLS_VERSION) return;
  await prisma.$transaction(async (tx) => {
    await takeTravTrackLock(tx, userId);
    await rebuildZoneCells(tx, userId);
  });
}
