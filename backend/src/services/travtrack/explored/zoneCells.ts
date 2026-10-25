/**
 * The explored map's zone raster (TravTrack plan L1; Codex and security
 * review of a3353f2a7): the zoom-14 tiles of every privacy zone in force AND
 * of every former zone's circle — none is ever left out — merged in cell
 * space into `travtrack_zone_cells`, each tile with its edge-connected
 * component. Its size is bounded by the area the circles cover, not by how
 * many there were: moving a zone back and forth adds nothing.
 *
 * The set only grows: a zone removed or moved leaves its old circle as a
 * former zone's. So a zone change adds its new circle's tiles incrementally,
 * in the change's own transaction under the TravTrack lock, and merges the
 * components they touch. An account never built is built whole by its first
 * explored-map request.
 *
 * Beyond `MAX_ZONE_CELLS` the account is marked `zoneCellsOverflow` and the
 * explored map refuses WHOLE (409 `TRAVTRACK_EXPLORED_UNAVAILABLE`): any
 * partial answer — a zone left out, or drawn as a hole — could outline it.
 * The zone itself is always made: privacy zones are never refused for this.
 */
import { prisma, type DbTransaction } from "../../../db";
import { Prisma } from "../../../prisma";
import logger from "../../../utils/logger";
import type { ZoneCircle } from "../classify";
import { takeTravTrackLock } from "../lock";
import { cellKey, TILES, type Cell } from "./cells";
import { circleCells, wrapX, zoneComponents } from "./zoneRaster";

/** Raised when the raster's rule changes; an account below it is rebuilt. */
export const ZONE_CELLS_VERSION = 1;
/** Merged raster tiles an account holds at most; beyond it the map refuses whole. */
export const MAX_ZONE_CELLS = 50_000;
const TOMBSTONE_PAGE = 500;

const usable = (c: ZoneCircle) => c.radiusM > 0;

async function markOverflow(tx: DbTransaction, userId: string, cells: number): Promise<void> {
  // Counts only: never a position.
  logger.warn({ operation: "travtrack.explored.zoneCellsOverflow", userId, cells });
  await tx.travTrackZoneCell.deleteMany({ where: { userId } });
  await tx.travTrackDerivationState.upsert({
    where: { userId },
    create: { userId, zoneCellsVersion: ZONE_CELLS_VERSION, zoneCellsOverflow: true },
    update: { zoneCellsVersion: ZONE_CELLS_VERSION, zoneCellsOverflow: true },
  });
}

/** Rebuilds the whole raster from every zone and every former zone. Under the lock. */
export async function rebuildZoneCells(tx: DbTransaction, userId: string): Promise<void> {
  const select = { lat: true, lon: true, radiusM: true } as const;
  const cells = new Map<string, Cell>();
  const add = (circle: ZoneCircle) => {
    if (!usable(circle)) return;
    for (const c of circleCells(circle)) cells.set(cellKey(c), c);
  };
  for (const z of await tx.travTrackPrivacyZone.findMany({ where: { userId }, select })) add(z);
  for (let cursor: string | undefined; ;) {
    const page = await tx.travTrackZoneTombstone.findMany({
      where: { userId },
      orderBy: { id: "asc" },
      select: { ...select, id: true },
      take: TOMBSTONE_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    page.forEach(add);
    if (cells.size > MAX_ZONE_CELLS) return markOverflow(tx, userId, cells.size);
    if (page.length < TOMBSTONE_PAGE) break;
    cursor = page[page.length - 1].id;
  }
  const rows = zoneComponents(cells.values()).flatMap((component, i) =>
    component.map((c) => ({ userId, x: c.x, y: c.y, component: i }))
  );
  await tx.travTrackZoneCell.deleteMany({ where: { userId } });
  if (rows.length > 0) await tx.travTrackZoneCell.createMany({ data: rows });
  await tx.travTrackDerivationState.upsert({
    where: { userId },
    create: { userId, zoneCellsVersion: ZONE_CELLS_VERSION, zoneCellsOverflow: false },
    update: { zoneCellsVersion: ZONE_CELLS_VERSION, zoneCellsOverflow: false },
  });
}

/**
 * Adds a circle just made a zone (created, or moved/resized to it) to the
 * raster, merging the components its tiles touch. Call inside the zone
 * change's transaction, after the zone is written.
 */
export async function addZoneCircle(
  tx: DbTransaction,
  userId: string,
  circle: ZoneCircle,
  /** `MAX_ZONE_CELLS` unless a test needs a small one. */
  cap = MAX_ZONE_CELLS
): Promise<void> {
  const state = await tx.travTrackDerivationState.findUnique({
    where: { userId },
    select: { zoneCellsVersion: true, zoneCellsOverflow: true },
  });
  if ((state?.zoneCellsVersion ?? 0) < ZONE_CELLS_VERSION) return rebuildZoneCells(tx, userId);
  if (state?.zoneCellsOverflow || !usable(circle)) return;

  const cells = circleCells(circle);
  const probe = new Map<string, Cell>();
  for (const c of cells) {
    probe.set(cellKey(c), c);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const y = c.y + dy;
      if (y >= 0 && y < TILES) {
        const n = { x: wrapX(c.x + dx), y };
        probe.set(cellKey(n), n);
      }
    }
  }
  const probed = [...probe.values()];
  const found = await tx.$queryRaw<(Cell & { component: number })[]>`
    SELECT z.x, z.y, z.component FROM travtrack_zone_cells z
      JOIN unnest(${probed.map((c) => c.x)}::int[], ${probed.map((c) => c.y)}::int[]) AS p(x, y)
        ON z.x = p.x AND z.y = p.y
     WHERE z.user_id = ${userId}`;
  const present = new Set(found.map(cellKey));
  const fresh = cells.filter((c) => !present.has(cellKey(c)));
  // Every tile already held: they were connected through this very circle before.
  if (fresh.length === 0) return;

  const held = await tx.travTrackZoneCell.count({ where: { userId } });
  if (held + fresh.length > cap) return markOverflow(tx, userId, held + fresh.length);

  const touched = [...new Set(found.map((c) => c.component))];
  const [{ next }] = await tx.$queryRaw<{ next: number }[]>`
    SELECT COALESCE(MAX(component) + 1, 0)::int AS next FROM travtrack_zone_cells
     WHERE user_id = ${userId}`;
  const id = touched.length > 0 ? Math.min(...touched) : next;
  await tx.travTrackZoneCell.createMany({
    data: fresh.map((c) => ({ userId, x: c.x, y: c.y, component: id })),
    skipDuplicates: true,
  });
  if (touched.length > 1) {
    await tx.$executeRaw`
      UPDATE travtrack_zone_cells SET component = ${id}
       WHERE user_id = ${userId} AND component IN (${Prisma.join(touched)})`;
  }
}

/** Builds the raster once for an account that never had it. */
export async function ensureZoneCells(userId: string): Promise<void> {
  const read = () =>
    prisma.travTrackDerivationState.findUnique({
      where: { userId },
      select: { zoneCellsVersion: true, zoneCellsOverflow: true },
    });
  const state = await read();
  if ((state?.zoneCellsVersion ?? 0) >= ZONE_CELLS_VERSION) return;
  await prisma.$transaction(
    async (tx) => {
      await takeTravTrackLock(tx, userId);
      await rebuildZoneCells(tx, userId);
    },
    { timeout: 60_000 }
  );
}
