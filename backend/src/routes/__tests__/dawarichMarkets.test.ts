import { Prisma } from "../../prisma";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { encryptApiKey } from "../../utils/encryption";
import { generateToken } from "../../utils/jwt";
import { reserveScan, scanStays } from "../../services/dawarich/stays/scan";
import type { DawarichClient, DawarichPoint } from "../../services/dawarich/dawarichClient";
jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));
const now = new Date("2026-10-11T06:00:00Z");
const points: DawarichPoint[] = [0, 10, 20, 30].map((m, i) => ({
  id: i + 1,
  latitude: 37.57,
  longitude: 126.97,
  timestampMs: Date.parse("2026-10-10T14:50:00Z") + m * 60_000,
  accuracy: 10,
  altitude: null,
  velocity: null,
  trackId: null,
}));
const client: DawarichClient = {
  checkHealth: async () => ({ reachable: true, version: null }),
  getPoints: async () => ({ points, truncated: false }),
};
let userId: string, otherId: string, cookie: string;
const api = () => request(app);
const review = {
  name: "Seoul stop",
  placeId: null,
  tripId: null,
  lat: 37.57,
  lon: 126.97,
  startAt: { local: "2026-10-10T23:50" },
  endAt: { local: "2026-10-11T00:20" },
};
beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `stay-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  otherId = (
    await prisma.user.create({
      data: { username: `stay-other-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  cookie = `auth_token=${generateToken(userId)}`;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, enabledDomains: ["poi"], data: {} },
    update: { enabledDomains: ["poi"], dawarichBaseUrl: null, dawarichApiKey: null },
  });
  await prisma.dawarichStay.deleteMany({ where: { userId } });
  await prisma.placeVisit.deleteMany({ where: { userId } });
  await prisma.place.deleteMany({ where: { userId } });
  await prisma.dawarichStayScan.upsert({
    where: { userId },
    create: { userId, enabled: true },
    update: {
      enabled: true,
      marketEnabled: false,
      venueEnabled: false,
      marketResult: Prisma.DbNull,
      leaseUntil: null,
      result: null,
    },
  });
});
describe("Automatic market suggestions", () => {
  const marketPoints = Array.from({ length: 21 }, (_, i) => ({
    ...points[0],
    id: i + 1,
    timestampMs: points[0].timestampMs + i * 60_000,
  }));
  const marketClient: DawarichClient = {
    ...client,
    getPoints: async () => ({ points: marketPoints, truncated: false }),
  };
  const raw = {
    elements: [
      {
        type: "way",
        id: 1234,
        tags: { amenity: "marketplace", name: "Test Market", wikidata: "Q1234" },
        geometry: [
          { lat: 37.569, lon: 126.969 },
          { lat: 37.571, lon: 126.969 },
          { lat: 37.571, lon: 126.971 },
          { lat: 37.569, lon: 126.971 },
          { lat: 37.569, lon: 126.969 },
        ],
      },
    ],
  };
  function memoryStore() {
    const cache = new Map<
      string,
      import("../../services/dawarich/marketVisits/catalog").CachedCatalog
    >();
    return {
      read: async (key: string) => cache.get(key) ?? null,
      write: async (
        key: string,
        payload: import("../../services/dawarich/marketVisits/osm").MarketCatalog,
        fetchedAt: Date
      ) => {
        cache.set(key, { payload, fetchedAt });
      },
      claim: async (at: Date) => at,
      complete: async () => {},
    };
  }
  async function run(options: Partial<Parameters<typeof scanStays>[1]> = {}) {
    await reserveScan(userId);
    return scanStays(userId, { now, client: marketClient, ...options });
  }
  it("does not query maps without the separate opt-in", async () => {
    const fetcher = jest.fn();
    await run({ marketFetcher: fetcher });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires scan consent and an own connection before market consent", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { enabled: false } });
    expect(
      (
        await api()
          .patch("/api/v1/dawarich-stays/settings")
          .set("Cookie", cookie)
          .send({ marketEnabled: true })
      ).status
    ).toBe(409);
    await prisma.dawarichStayScan.update({ where: { userId }, data: { enabled: true } });
    expect(
      (
        await api()
          .patch("/api/v1/dawarich-stays/settings")
          .set("Cookie", cookie)
          .send({ marketEnabled: true })
      ).body.code
    ).toBe("DAWARICH_OWN_CONNECTION_REQUIRED");
    await prisma.userSettings.update({
      where: { userId },
      data: {
        dawarichBaseUrl: "https://dawarich.example.test",
        dawarichApiKey: encryptApiKey("synthetic-key"),
      },
    });
    expect(
      (
        await api()
          .patch("/api/v1/dawarich-stays/settings")
          .set("Cookie", cookie)
          .send({ marketEnabled: true })
      ).status
    ).toBe(200);
    await prisma.userSettings.update({ where: { userId }, data: { enabledDomains: [] } });
    expect(
      (
        await api()
          .patch("/api/v1/dawarich-stays/settings")
          .set("Cookie", cookie)
          .send({ marketEnabled: false })
      ).status
    ).toBe(200);
  });
  it("stores one venue, reuses cached boundaries, preserves rejection and creates no visits", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    const store = memoryStore(),
      fetcher = jest.fn(async () => Response.json(raw));
    const first = await run({ marketStore: store, marketFetcher: fetcher });
    expect(first.markets?.createdCount).toBe(1);
    const row = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    expect(row.name).toBe("Test Market");
    expect(row.evidence).toMatchObject({
      kind: "market",
      market: { identity: "wikidata:Q1234", osmRef: "way/1234" },
    });
    expect(await prisma.place.count({ where: { userId } })).toBe(0);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
    await api().post(`/api/v1/dawarich-stays/${row.id}/reject`).set("Cookie", cookie).send({});
    expect((await run({ marketStore: store, marketFetcher: fetcher })).created).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(1);
  });
  it("supersedes old pending fragments while preserving their original evidence", async () => {
    await run();
    const old = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    await run({
      marketStore: memoryStore(),
      marketFetcher: jest.fn(async () => Response.json(raw)),
    });
    const source = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: old.id } });
    expect(source.status).toBe("superseded");
    expect(source.evidence).toEqual(old.evidence);
    const pending = await prisma.dawarichStay.findMany({ where: { userId, status: "pending" } });
    expect(pending).toHaveLength(1);
    expect(pending[0].name).toBe("Test Market");
    expect(pending[0].evidence).toMatchObject({ supersededFindingIds: [old.id] });
    expect(
      (
        await api()
          .post(`/api/v1/dawarich-stays/${old.id}/accept`)
          .set("Cookie", cookie)
          .send(review)
      ).status
    ).toBe(409);
  });
  it("does not mistake a confirmed shop inside the market for the whole venue", async () => {
    await run();
    const row = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    expect(
      (
        await api()
          .post(`/api/v1/dawarich-stays/${row.id}/accept`)
          .set("Cookie", cookie)
          .send({ ...review, name: "Individual shop" })
      ).status
    ).toBe(200);
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    const result = await run({
      marketStore: memoryStore(),
      marketFetcher: jest.fn(async () => Response.json(raw)),
    });
    expect(result.markets?.createdCount).toBe(1);
    expect(await prisma.dawarichStay.count({ where: { userId, status: "accepted" } })).toBe(1);
    expect(
      await prisma.dawarichStay.count({ where: { userId, status: "pending", name: "Test Market" } })
    ).toBe(1);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
  });
  it("confirms a market exactly once with its map identity", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    await run({
      marketStore: memoryStore(),
      marketFetcher: jest.fn(async () => Response.json(raw)),
    });
    const row = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    const url = `/api/v1/dawarich-stays/${row.id}/accept`;
    const payload = { ...review, name: "Test Market" };
    const first = await api().post(url).set("Cookie", cookie).send(payload);
    expect(first.status).toBe(200);
    const second = await api().post(url).set("Cookie", cookie).send(payload);
    expect(second.body.data.visitId).toBe(first.body.data.visitId);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
    expect(await prisma.place.findFirstOrThrow({ where: { userId } })).toMatchObject({
      category: "shopping",
      externalRef: "osm:way/1234",
      wikidataId: "Q1234",
    });
  });
  it("recognizes an existing market visit without duplicating it or its stationary fragment", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    const place = await prisma.place.create({
      data: { userId, name: "Test Market", lat: 37.57, lon: 126.97 },
    });
    await prisma.placeVisit.create({
      data: {
        userId,
        placeId: place.id,
        visitedAt: new Date("2026-10-10T00:00:00Z"),
        visitedPrecision: "day",
      },
    });
    const result = await run({
      marketStore: memoryStore(),
      marketFetcher: jest.fn(async () => Response.json(raw)),
    });
    expect(result.markets?.alreadyRecordedCount).toBe(1);
    expect(result.created).toBe(0);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
  });
  it("does not attach the old market identity to a user correction", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    await run({
      marketStore: memoryStore(),
      marketFetcher: jest.fn(async () => Response.json(raw)),
    });
    const row = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    expect(
      (
        await api()
          .post(`/api/v1/dawarich-stays/${row.id}/accept`)
          .set("Cookie", cookie)
          .send({ ...review, name: "Corrected place" })
      ).status
    ).toBe(200);
    expect(await prisma.place.findFirstOrThrow({ where: { userId } })).toMatchObject({
      name: "Corrected place",
      externalRef: null,
      wikidataId: null,
      category: "other",
    });
  });
  it("reports map failures without losing stationary suggestions", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    const result = await run({
      marketStore: memoryStore(),
      marketFetcher: jest.fn(async () => new Response("busy", { status: 429 })),
    });
    expect(result.markets?.status).toBe("partial");
    expect(result.created).toBe(1);
    expect((await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } })).result).toBe(
      "partial"
    );
  });
  it("discards a map response after consent is revoked", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    const store = memoryStore(),
      write = jest.spyOn(store, "write");
    await run({
      marketStore: store,
      marketFetcher: jest.fn(async () => {
        await api()
          .patch("/api/v1/dawarich-stays/settings")
          .set("Cookie", cookie)
          .send({ marketEnabled: false });
        return Response.json(raw);
      }),
    });
    expect(write).not.toHaveBeenCalled();
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(0);
  });
  it.each([
    [{ shop: "mall" }, "mall", "shopping"],
    [{ leisure: "park" }, "park", "nature"],
    [{ tourism: "zoo" }, "zoo", "nature"],
    [{ tourism: "theme_park" }, "themePark", "entertainment"],
    [{ tourism: "museum" }, "museum", "museum"],
  ])("keeps %j as one reviewable venue and confirms it once", async (tags, type, category) => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { venueEnabled: true } });
    const payload = {
      elements: [{ ...raw.elements[0], tags: { ...tags, name: "Whole venue", wikidata: "Q5678" } }],
    };
    const store = memoryStore();
    const fetcher = jest.fn(async () => Response.json(payload));
    const result = await run({ marketStore: store, marketFetcher: fetcher });
    expect(result.markets?.createdCount).toBe(1);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
    const row = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    expect(row.evidence).toMatchObject({
      kind: "venue",
      market: { venueType: type, osmRef: "way/1234" },
    });
    expect((await run({ marketStore: store, marketFetcher: fetcher })).created).toBe(0);
    const url = `/api/v1/dawarich-stays/${row.id}/accept`;
    const first = await api()
      .post(url)
      .set("Cookie", cookie)
      .send({ ...review, name: "Whole venue" });
    expect(first.status).toBe(200);
    const second = await api()
      .post(url)
      .set("Cookie", cookie)
      .send({ ...review, name: "Whole venue" });
    expect(second.body.data.visitId).toBe(first.body.data.visitId);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
    expect(await prisma.place.findFirstOrThrow({ where: { userId } })).toMatchObject({
      category,
      externalRef: "osm:way/1234",
      wikidataId: "Q5678",
    });
  });
  it("does not broaden market consent into other venue types", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { marketEnabled: true } });
    await run({
      marketStore: memoryStore(),
      marketFetcher: async () =>
        Response.json({ elements: [{ ...raw.elements[0], tags: { shop: "mall", name: "Mall" } }] }),
    });
    expect(await prisma.dawarichStay.count({ where: { userId, name: "Mall" } })).toBe(0);
  });
  it("keeps market findings off when only other venues are enabled", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { venueEnabled: true } });
    const result = await run({
      marketStore: memoryStore(),
      marketFetcher: async () => Response.json(raw),
    });
    expect(result.markets?.createdCount).toBe(0);
    expect(await prisma.dawarichStay.count({ where: { userId, name: "Test Market" } })).toBe(0);
  });
  it("requires an own connection for venue consent and permits revocation with hidden Places", async () => {
    const url = "/api/v1/dawarich-stays/settings";
    expect(
      (await api().patch(url).set("Cookie", cookie).send({ venueEnabled: true })).body.code
    ).toBe("DAWARICH_OWN_CONNECTION_REQUIRED");
    await prisma.userSettings.update({
      where: { userId },
      data: {
        dawarichBaseUrl: "https://dawarich.example.test",
        dawarichApiKey: encryptApiKey("synthetic-key"),
      },
    });
    expect((await api().patch(url).set("Cookie", cookie).send({ venueEnabled: true })).status).toBe(
      200
    );
    await prisma.userSettings.update({ where: { userId }, data: { enabledDomains: [] } });
    expect(
      (await api().patch(url).set("Cookie", cookie).send({ venueEnabled: false })).status
    ).toBe(200);
  });
  it("discards broad map responses after venue consent is revoked", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { venueEnabled: true } });
    const store = memoryStore(),
      write = jest.spyOn(store, "write");
    await run({
      marketStore: store,
      marketFetcher: async () => {
        await api()
          .patch("/api/v1/dawarich-stays/settings")
          .set("Cookie", cookie)
          .send({ venueEnabled: false });
        return Response.json({
          elements: [{ ...raw.elements[0], tags: { shop: "mall", name: "Mall" } }],
        });
      },
    });
    expect(write).not.toHaveBeenCalled();
    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(0);
  });
  it("keeps a museum inside a park as an independent venue", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { venueEnabled: true } });
    const elements = [
      { ...raw.elements[0], id: 2001, tags: { leisure: "park", name: "Park", wikidata: "Q7654" } },
      {
        ...raw.elements[0],
        id: 2002,
        tags: { tourism: "museum", name: "Museum", wikidata: "Q7654" },
      },
    ];
    await run({
      marketStore: memoryStore(),
      marketFetcher: async () => Response.json({ elements }),
    });
    const rows = await prisma.dawarichStay.findMany({ where: { userId, status: "pending" } });
    expect(rows.map((r) => r.name).sort()).toEqual(["Museum", "Park"]);
    expect(
      rows.every((r) =>
        (r.evidence as { uncertainties: string[] }).uncertainties.includes("overlappingMarkets")
      )
    ).toBe(true);
  });
});
