import { prisma } from "../../../db";
import { marketCatalogStore } from "./catalogStore";
const id = "public-market-catalog";
const at = new Date("2026-10-15T12:00:00Z");
afterAll(async () => {
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.marketCatalogState.upsert({
    where: { id },
    create: { id, day: new Date("2026-10-15T00:00:00Z") },
    update: {
      day: new Date("2026-10-15T00:00:00Z"),
      requests: 0,
      bytes: 0,
      leaseUntil: null,
      backoffUntil: null,
    },
  });
});
it("allows only one network lease across competing processes", async () => {
  const tokens = await Promise.all(Array.from({ length: 8 }, () => marketCatalogStore.claim(at)));
  expect(tokens.filter(Boolean)).toHaveLength(1);
  expect((await prisma.marketCatalogState.findUniqueOrThrow({ where: { id } })).requests).toBe(1);
});
it.each([
  { requests: 80, bytes: 0 },
  { requests: 0, bytes: 4000000 },
])("stops at the durable daily budget %p", async (data) => {
  await prisma.marketCatalogState.update({ where: { id }, data });
  expect(await marketCatalogStore.claim(at)).toBeNull();
});
it("keeps backoff across requests and ignores completion of an expired owner", async () => {
  const first = (await marketCatalogStore.claim(at))!;
  const next = (await marketCatalogStore.claim(new Date(at.getTime() + 21000)))!;
  expect(next).not.toBeNull();
  await marketCatalogStore.complete(first, 1000, 30000);
  expect((await prisma.marketCatalogState.findUniqueOrThrow({ where: { id } })).leaseUntil).toEqual(
    next
  );
  await marketCatalogStore.complete(next, 500, 30000);
  const state = await prisma.marketCatalogState.findUniqueOrThrow({ where: { id } });
  expect(state.bytes).toBe(500);
  expect(await marketCatalogStore.claim(new Date(state.backoffUntil!.getTime() - 1))).toBeNull();
});
it("resets the daily budget without bypassing an active network lease", async () => {
  await prisma.marketCatalogState.update({ where: { id }, data: { requests: 80, bytes: 4000000 } });
  const nextDay = new Date("2026-10-16T00:00:01Z");
  const token = await marketCatalogStore.claim(nextDay);
  expect(token).not.toBeNull();
  const state = await prisma.marketCatalogState.findUniqueOrThrow({ where: { id } });
  expect(state.requests).toBe(1);
  expect(state.bytes).toBe(0);
});
it("stores public catalog data durably and validates cached geometry", async () => {
  const key = "market-v1:synthetic:durability";
  const payload = { areas: [], missingAreas: [], invalidCount: 0, sourceTimestamp: null };
  await marketCatalogStore.write(key, payload, at);
  expect(await marketCatalogStore.read(key)).toEqual({ payload, fetchedAt: at });
  await prisma.marketCatalogTile.update({
    where: { key },
    data: { payload: { areas: [{ bad: true }], missingAreas: [], invalidCount: 0 } },
  });
  expect(await marketCatalogStore.read(key)).toBeNull();
});
it("makes room by evicting the oldest tile instead of refusing every new one", async () => {
  await prisma.marketCatalogTile.deleteMany({ where: { key: { startsWith: "evict:" } } });
  const fill = 2048 - (await prisma.marketCatalogTile.count());
  const payload = { areas: [], missingAreas: [], invalidCount: 0, sourceTimestamp: null };
  await prisma.marketCatalogTile.createMany({
    data: Array.from({ length: fill }, (_, i) => ({
      key: `evict:${String(i).padStart(4, "0")}`,
      payload,
      fetchedAt: new Date(Date.UTC(2020, 0, 1) - (fill - i) * 1000),
    })),
  });
  try {
    await marketCatalogStore.write("evict:new", payload, at);
    expect(await marketCatalogStore.read("evict:new")).toEqual({ payload, fetchedAt: at });
    expect(await prisma.marketCatalogTile.count()).toBe(2048);
    // The oldest fill row (fetched furthest back) made room.
    expect(await prisma.marketCatalogTile.findUnique({ where: { key: "evict:0000" } })).toBeNull();
  } finally {
    await prisma.marketCatalogTile.deleteMany({ where: { key: { startsWith: "evict:" } } });
  }
});
