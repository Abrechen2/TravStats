/**
 * The explored map's zone raster (TravTrack plan L1; Codex and security
 * review of a3353f2a7): the zoom-14 tiles of every privacy zone in force AND
 * of every former zone's circle — none is ever left out — merged in cell
 * space into `travtrack_zone_cells`, each tile with its edge-connected
 * component. Its size is bounded by the area the circles cover, not by how
 * many there were: moving a zone back and forth adds nothing.
 *
 * The set only grows: a zone removed or moved leaves its old circle as a
 * former zone's. So the raster is strictly incremental (Codex re-review): a
 * zone write adds its new circle's tiles once, at write time, in its own
 * transaction under the TravTrack lock, and merges the components they
 * touch. A map request never rasterises anything. An account whose raster
 * was never built — zones from before the explored map — is built by a
 * bounded background job (`buildPendingZoneRasters`, from the projection
 * scheduler), a slice of former circles per tick; its map answers 409
 * `TRAVTRACK_EXPLORED_PREPARING` until the build is done.
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
/** Former circles one background slice adds at most. */
export const BUILD_CIRCLES_PER_STEP = 100;
/** Accounts one scheduler tick advances at most. */
export const BUILD_ACCOUNTS_PER_TICK = 10;

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
    select: { zoneCellsVersion: true, zoneCellsOverflow: true, zoneCellsBuildCursor: true },
  });
  if (state?.zoneCellsOverflow || !usable(circle)) return;
  // Not built yet: the circle is added all the same, the build adds the rest.
  // An account whose only zone is this new one, with no former zone, is then
  // complete: nothing is left for a build to add.
  if ((state?.zoneCellsVersion ?? 0) < ZONE_CELLS_VERSION) {
    const zones = await tx.travTrackPrivacyZone.count({ where: { userId } });
    const former = await tx.travTrackZoneTombstone.count({ where: { userId } });
    if (zones <= 1 && former === 0 && !state?.zoneCellsBuildCursor) {
      await addCells(tx, userId, circle, cap);
      await markBuilt(tx, userId);
      return;
    }
  }
  await addCells(tx, userId, circle, cap);
}

/** The circle's tiles merged into the raster, components joined; overflow marked. */
async function addCells(
  tx: DbTransaction,
  userId: string,
  circle: ZoneCircle,
  cap: number
): Promise<void> {
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

export type ZoneRasterState = "ready" | "preparing";

/**
 * Whether the account's raster can be read. An account holding no zone and
 * no former zone has nothing to build and is marked ready on the spot —
 * without rasterising anything. Read inside the map's snapshot.
 */
export async function zoneRasterState(
  db: Pick<DbTransaction, "travTrackDerivationState" | "$queryRaw">,
  userId: string
): Promise<ZoneRasterState> {
  const state = await db.travTrackDerivationState.findUnique({
    where: { userId },
    select: { zoneCellsVersion: true },
  });
  if ((state?.zoneCellsVersion ?? 0) >= ZONE_CELLS_VERSION) return "ready";
  const [{ any }] = await db.$queryRaw<{ any: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM travtrack_privacy_zones WHERE user_id = ${userId})
        OR EXISTS (SELECT 1 FROM travtrack_zone_tombstones WHERE user_id = ${userId}) AS any`;
  return any ? "preparing" : "ready";
}

const markBuilt = (tx: DbTransaction, userId: string) =>
  tx.travTrackDerivationState.upsert({
    where: { userId },
    create: { userId, zoneCellsVersion: ZONE_CELLS_VERSION },
    update: { zoneCellsVersion: ZONE_CELLS_VERSION },
  });

/**
 * One slice of an account's background build, in one transaction under the
 * lock: on the first slice every zone in force, then up to `maxCircles`
 * former circles after the cursor (by id). A former circle made after the
 * build began was a zone the build or a write already added, so the cursor
 * never needs to look back.
 */
export async function buildZoneRasterStep(
  userId: string,
  maxCircles = BUILD_CIRCLES_PER_STEP
): Promise<"done" | "more"> {
  return prisma.$transaction(
    async (tx) => {
      await takeTravTrackLock(tx, userId);
      const state = await tx.travTrackDerivationState.findUnique({
        where: { userId },
        select: { zoneCellsVersion: true, zoneCellsOverflow: true, zoneCellsBuildCursor: true },
      });
      if ((state?.zoneCellsVersion ?? 0) >= ZONE_CELLS_VERSION) return "done" as const;
      const select = { lat: true, lon: true, radiusM: true } as const;
      const cursor = state?.zoneCellsBuildCursor ?? null;
      if (cursor === null) {
        for (const z of await tx.travTrackPrivacyZone.findMany({ where: { userId }, select })) {
          await addZoneCircle(tx, userId, z);
        }
      }
      const page = await tx.travTrackZoneTombstone.findMany({
        where: { userId, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        select: { ...select, id: true },
        take: maxCircles,
      });
      for (const c of page) await addZoneCircle(tx, userId, c);
      const last = page.length > 0 ? page[page.length - 1].id : (cursor ?? "");
      await tx.travTrackDerivationState.upsert({
        where: { userId },
        create: { userId, zoneCellsBuildCursor: last },
        update: { zoneCellsBuildCursor: last },
      });
      if (page.length < maxCircles) {
        await markBuilt(tx, userId);
        return "done" as const;
      }
      return "more" as const;
    },
    { timeout: 60_000 }
  );
}

/**
 * The scheduler's pass: up to `maxAccounts` accounts whose raster was never
 * built and that hold a zone or a former zone, one slice each. Bounded per
 * tick; the rest continue on the next.
 */
export async function buildPendingZoneRasters({
  maxAccounts = BUILD_ACCOUNTS_PER_TICK,
  maxCircles = BUILD_CIRCLES_PER_STEP,
}: { maxAccounts?: number; maxCircles?: number } = {}): Promise<number> {
  const accounts = await prisma.$queryRaw<{ id: string }[]>`
    SELECT u.id FROM users u
      LEFT JOIN travtrack_derivation_state s ON s.user_id = u.id
     WHERE COALESCE(s.zone_cells_version, 0) < ${ZONE_CELLS_VERSION}
       AND (EXISTS (SELECT 1 FROM travtrack_privacy_zones z WHERE z.user_id = u.id)
            OR EXISTS (SELECT 1 FROM travtrack_zone_tombstones t WHERE t.user_id = u.id))
     ORDER BY u.id
     LIMIT ${maxAccounts}`;
  for (const { id } of accounts) {
    try {
      await buildZoneRasterStep(id, maxCircles);
    } catch (error) {
      logger.warn({
        operation: "travtrack.explored.zoneRasterBuildFailed",
        userId: id,
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return accounts.length;
}
