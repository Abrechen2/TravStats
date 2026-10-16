import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { validateAreas } from "./geometry";
import type { CatalogStore } from "./catalog";
import type { MarketCatalog } from "./osm";
const STATE = "public-market-catalog";
/** Tiles kept instance-wide. */
export const MAX_CATALOG_TILES = 2048;

/**
 * Evict the oldest tiles until one more fits. A full cache used to refuse
 * every write, so once 2048 tiles existed no new area was ever cached again and
 * each scan of it spent the shared daily Overpass budget anew.
 */
async function makeRoom(): Promise<void> {
  const excess = (await prisma.marketCatalogTile.count()) - MAX_CATALOG_TILES + 1;
  if (excess <= 0) return;
  const oldest = await prisma.marketCatalogTile.findMany({
    select: { key: true },
    orderBy: [{ fetchedAt: "asc" }, { key: "asc" }],
    take: excess,
  });
  await prisma.marketCatalogTile.deleteMany({ where: { key: { in: oldest.map((t) => t.key) } } });
}
/** Public cache only; the budget/lease is shared by all users and server processes. */
export const marketCatalogStore: CatalogStore = {
  async read(key) {
    const row = await prisma.marketCatalogTile.findUnique({ where: { key } });
    if (!row) return null;
    try {
      const value = row.payload as unknown as MarketCatalog;
      if (
        !Array.isArray(value.areas) ||
        !Array.isArray(value.missingAreas) ||
        !Number.isInteger(value.invalidCount)
      )
        return null;
      validateAreas(value.areas);
      return { payload: value, fetchedAt: row.fetchedAt };
    } catch {
      return null;
    }
  },
  async write(key, payload, at) {
    const exists = await prisma.marketCatalogTile.findUnique({
      where: { key },
      select: { key: true },
    });
    if (!exists) await makeRoom();
    const data = { payload: payload as unknown as Prisma.InputJsonValue, fetchedAt: at };
    await prisma.marketCatalogTile.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });
  },
  async claim(at) {
    const day = new Date(at.toISOString().slice(0, 10) + "T00:00:00Z");
    await prisma.marketCatalogState.upsert({
      where: { id: STATE },
      create: { id: STATE, day },
      update: {},
    });
    await prisma.marketCatalogState.updateMany({
      where: { id: STATE, day: { lt: day } },
      data: { day, requests: 0, bytes: 0 },
    });
    const token = new Date(at.getTime() + 20000);
    const acquired = await prisma.marketCatalogState.updateMany({
      where: {
        id: STATE,
        day,
        requests: { lt: 80 },
        bytes: { lt: 4000000 },
        AND: [
          { OR: [{ leaseUntil: null }, { leaseUntil: { lt: at } }] },
          { OR: [{ backoffUntil: null }, { backoffUntil: { lte: at } }] },
        ],
      },
      data: { requests: { increment: 1 }, leaseUntil: token },
    });
    return acquired.count ? token : null;
  },
  async complete(token, bytes, backoffMs) {
    await prisma.marketCatalogState.updateMany({
      where: { id: STATE, leaseUntil: token },
      data: {
        leaseUntil: null,
        bytes: { increment: Math.max(0, Math.min(bytes, 100000000)) },
        backoffUntil: backoffMs ? new Date(Date.now() + backoffMs) : null,
      },
    });
  },
};
