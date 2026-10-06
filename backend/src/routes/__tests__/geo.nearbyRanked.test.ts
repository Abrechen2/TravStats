import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { REVERSE_CANDIDATE_POOL } from "../../services/geo/photon";
import { PLACE_RANK } from "../../services/geo/placeImportance";

/**
 * forgejo#209 through the real route AND the real Photon service, with only
 * `fetch` stubbed — so what is asserted is what reaches Photon and what the
 * client gets back, not what one mock hands another.
 */

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const origin = { lat: 52.5163, lon: 13.3777 };

/** A hit `metres` due north of the origin, in a Latin-script country (no name merge). */
const hit = (name: string, osmKey: string, osmValue: string, metres: number, id: number) => ({
  properties: {
    name,
    osm_key: osmKey,
    osm_value: osmValue,
    type: "house",
    osm_type: "N",
    osm_id: id,
    city: "Berlin",
    countrycode: "DE",
  },
  geometry: { coordinates: [origin.lon, origin.lat + metres / 111_195] },
});

// Photon's own order: nearest first. Twenty-two hits, more than the max limit.
const nearestFirst = [
  hit("Bushaltestelle Unter den Linden", "highway", "bus_stop", 50, 1),
  ...Array.from({ length: 20 }, (_, i) =>
    hit(`Laden ${i + 1}`, "shop", "clothes", 60 + i * 10, 100 + i)
  ),
  hit("Kronprinzenpalais", "historic", "palace", 400, 2),
];

describe("forgejo#209 — ranked nearby places and location-biased search", () => {
  const realFetch = global.fetch;
  let authCookie: string;
  let userId: string;
  let photonUrls: URL[];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "geonearbyranked" } });
    const user = await prisma.user.create({
      data: { username: "geonearbyranked", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    photonUrls = [];
    global.fetch = jest.fn(async (raw: string) => {
      photonUrls.push(new URL(raw));
      return jsonResponse({ features: nearestFirst });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const reversePlaces = (query: string) =>
    request(app)
      .get(`/api/v1/geo/reverse-places?lat=${origin.lat}&lon=${origin.lon}${query}`)
      .set("Cookie", authCookie);

  describe("GET /geo/reverse-places", () => {
    it("puts the palace 400 m away above the bus stop 50 m away, with its rank", async () => {
      const res = await reversePlaces("");

      expect(res.status).toBe(200);
      expect(res.body.degraded).toBe(false);
      expect(res.body.data[0]).toMatchObject({ name: "Kronprinzenpalais", rank: PLACE_RANK.HIGH });
      // Within the low tier, distance decides: the bus stop is the nearest.
      expect(res.body.data[1]).toMatchObject({
        name: "Bushaltestelle Unter den Linden",
        rank: PLACE_RANK.LOW,
      });
    });

    it("answers five places when no limit is given — the map-pick modal's list", async () => {
      const res = await reversePlaces("");
      expect(res.body.data).toHaveLength(5);
      expect(photonUrls[0].searchParams.get("limit")).toBe(String(REVERSE_CANDIDATE_POOL));
      expect(photonUrls[0].searchParams.has("radius")).toBe(false);
    });

    it("honours a limit up to 20", async () => {
      expect((await reversePlaces("&limit=12")).body.data).toHaveLength(12);
      expect((await reversePlaces("&limit=20")).body.data).toHaveLength(20);
    });

    it.each(["0", "21", "2.5", "abc"])("refuses limit=%s with VALIDATION_FAILED", async (limit) => {
      const res = await reversePlaces(`&limit=${limit}`);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "VALIDATION_FAILED", field: "limit" });
      expect(photonUrls).toHaveLength(0);
    });

    it("passes radiusKm to Photon as radius", async () => {
      const res = await reversePlaces("&radiusKm=2.5");
      expect(res.status).toBe(200);
      expect(photonUrls[0].searchParams.get("radius")).toBe("2.5");
    });

    it.each(["0", "-1", "5.1", "abc"])(
      "refuses radiusKm=%s with VALIDATION_FAILED",
      async (radiusKm) => {
        const res = await reversePlaces(`&radiusKm=${radiusKm}`);
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: "VALIDATION_FAILED", field: "radiusKm" });
        expect(photonUrls).toHaveLength(0);
      }
    );
  });

  describe("GET /geo/search", () => {
    const search = (query: string) =>
      request(app).get(`/api/v1/geo/search?q=palace${query}`).set("Cookie", authCookie);

    it("passes lat and lon to Photon when both are given", async () => {
      const res = await search("&lat=37.5796&lon=126.977");
      expect(res.status).toBe(200);
      expect(photonUrls[0].pathname).toBe("/api/");
      expect(photonUrls[0].searchParams.get("lat")).toBe("37.5796");
      expect(photonUrls[0].searchParams.get("lon")).toBe("126.977");
    });

    it("sends no position when neither is given", async () => {
      const res = await search("");
      expect(res.status).toBe(200);
      expect(photonUrls[0].searchParams.has("lat")).toBe(false);
      expect(photonUrls[0].searchParams.has("lon")).toBe(false);
      // A search is not ranked.
      expect(res.body.data[0].rank).toBeUndefined();
    });

    it.each([
      ["&lat=37.5796", "lon"],
      ["&lon=126.977", "lat"],
    ])("refuses half a position (%s) and names the missing half", async (query, missing) => {
      const res = await search(query);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "VALIDATION_FAILED", field: missing });
      expect(res.body.error).toContain("lat and lon must be given together");
      expect(photonUrls).toHaveLength(0);
    });

    it("refuses an out-of-range bias point", async () => {
      const res = await search("&lat=91&lon=0");
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: "VALIDATION_FAILED", field: "lat" });
    });
  });
});
