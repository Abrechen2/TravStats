import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { mockFetch, type FetchMock } from "../../services/openData/__tests__/fetchMock";

/**
 * The OpenStreetMap enrichment of a lodging, previewed before it writes
 * (2026-10-22). The matched house used to appear only in a debug log, so a
 * wrong match — a neighbour's stars in the user's record — could not be
 * spotted. The preview names the house; the apply writes only the house the
 * user confirmed, and records it as the lodging's external reference.
 */

const ADLON = {
  type: "way",
  id: 123,
  center: { lat: 52.5162, lon: 13.3801 },
  tags: {
    name: "Adlon Kempinski",
    tourism: "hotel",
    stars: "5",
    brand: "Kempinski",
    wikidata: "Q698095",
    website: "https://www.kempinski.com/adlon",
  },
};
const OVERPASS = { elements: [ADLON] };

describe("lodging enrichment preview and apply", () => {
  let cookie: string;
  let userId: string;
  let settingsId: number;
  let previousSwitch: boolean;
  let fetches: FetchMock | null = null;
  let chainId: number;

  const setSwitch = (on: boolean) =>
    prisma.adminSettings.update({ where: { id: settingsId }, data: { openDataEnabled: on } });

  const adlon = (data: Record<string, unknown> = {}) =>
    prisma.lodging.create({
      data: {
        userId,
        type: "hotel",
        name: "Hotel Adlon Kempinski Berlin",
        lat: 52.5162,
        lon: 13.38,
        ...data,
      },
    });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "osmpreview1" } });
    const u = await prisma.user.create({
      data: { username: "osmpreview1", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    const settings =
      (await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } })) ??
      (await prisma.adminSettings.create({ data: {} }));
    settingsId = settings.id;
    previousSwitch = settings.openDataEnabled;
    chainId = (
      await prisma.lodgingChain.upsert({
        where: { name: "Kempinski" },
        update: {},
        create: { name: "Kempinski" },
      })
    ).id;
  });

  beforeEach(async () => {
    await setSwitch(true);
    await prisma.lodging.deleteMany({ where: { userId } });
  });

  afterEach(() => {
    fetches?.restore();
    fetches = null;
  });

  afterAll(async () => {
    await setSwitch(previousSwitch);
    await prisma.user.deleteMany({ where: { username: "osmpreview1" } });
    await prisma.$disconnect();
  });

  describe("GET — the preview", () => {
    it("names the matched house, its distance and link, and each field's current and proposed value", async () => {
      const lodging = await adlon({ stars: 4 });
      fetches = mockFetch([[/overpass-api\.de/, OVERPASS]]);
      const res = await request(app)
        .get(`/api/v1/lodging/${lodging.id}/enrich`)
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.match).toEqual({
        osmRef: "osm:way/123",
        osmType: "way",
        osmId: 123,
        name: "Adlon Kempinski",
        distanceM: 7,
        url: "https://www.openstreetmap.org/way/123",
      });
      expect(res.body.storesReference).toBe(true);
      const byField = Object.fromEntries(
        (res.body.fields as Array<{ field: string }>).map((f) => [f.field, f])
      );
      // The user's 4 stars stay — and the disagreement is shown, not hidden.
      expect(byField.stars).toEqual({ field: "stars", current: 4, proposed: 5, apply: false });
      expect(byField.website).toEqual({
        field: "website",
        current: null,
        proposed: "https://www.kempinski.com/adlon",
        apply: true,
      });
      expect(byField.wikidataId).toMatchObject({ current: null, proposed: "Q698095", apply: true });
      expect(byField.chain).toMatchObject({ current: null, proposed: "Kempinski", apply: true });
    });

    it("writes nothing", async () => {
      const lodging = await adlon();
      fetches = mockFetch([[/overpass-api\.de/, OVERPASS]]);
      await request(app).get(`/api/v1/lodging/${lodging.id}/enrich`).set("Cookie", cookie);
      const stored = await prisma.lodging.findUniqueOrThrow({ where: { id: lodging.id } });
      expect(stored).toMatchObject({
        stars: null,
        website: null,
        wikidataId: null,
        chainId: null,
        externalRef: null,
      });
    });

    it.each([
      [504, "timeout"],
      [429, "rateLimited"],
      [503, "unavailable"],
    ])("reports an Overpass %s as %s, not as notFound", async (status, reason) => {
      const lodging = await adlon();
      fetches = mockFetch([[/overpass-api\.de/, { error: "busy" }, status]]);
      const res = await request(app)
        .get(`/api/v1/lodging/${lodging.id}/enrich`)
        .set("Cookie", cookie);
      expect(res.body).toEqual({
        found: false,
        reason,
        match: null,
        fields: [],
        storesReference: false,
      });
    });

    it("says notFound when no house nearby carries the name, and noCoordinates without a pin", async () => {
      const lodging = await adlon({ name: "Pension Sonnenschein" });
      fetches = mockFetch([[/overpass-api\.de/, OVERPASS]]);
      const res = await request(app)
        .get(`/api/v1/lodging/${lodging.id}/enrich`)
        .set("Cookie", cookie);
      expect(res.body).toMatchObject({ found: false, reason: "notFound", match: null });

      const pinless = await adlon({ lat: null, lon: null });
      const res2 = await request(app)
        .get(`/api/v1/lodging/${pinless.id}/enrich`)
        .set("Cookie", cookie);
      expect(res2.body).toMatchObject({ found: false, reason: "noCoordinates" });
    });

    it("answers openDataDisabled while the switch is off, without asking anyone", async () => {
      await setSwitch(false);
      const lodging = await adlon();
      fetches = mockFetch([]);
      const res = await request(app)
        .get(`/api/v1/lodging/${lodging.id}/enrich`)
        .set("Cookie", cookie);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("openDataDisabled");
      expect(fetches.calls).toHaveLength(0);
    });

    it("does not offer to store the reference when the lodging already carries one", async () => {
      const lodging = await adlon({ externalRef: "google:ChIJabc" });
      fetches = mockFetch([[/overpass-api\.de/, OVERPASS]]);
      const res = await request(app)
        .get(`/api/v1/lodging/${lodging.id}/enrich`)
        .set("Cookie", cookie);
      expect(res.body.storesReference).toBe(false);
    });
  });

  describe("POST — the apply", () => {
    it("fills only the empty fields and records the matched house as the external reference", async () => {
      const lodging = await adlon({ stars: 4 });
      fetches = mockFetch([[/overpass-api\.de/, OVERPASS]]);
      const res = await request(app)
        .post(`/api/v1/lodging/${lodging.id}/enrich`)
        .set("Cookie", cookie)
        .send({ expectedOsmRef: "osm:way/123" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        found: true,
        osmRef: "osm:way/123",
        osmName: "Adlon Kempinski",
        referenceStored: true,
        match: { url: "https://www.openstreetmap.org/way/123", distanceM: 7 },
      });
      expect(res.body.filled.sort()).toEqual(["chain", "website", "wikidataId"]);
      const stored = await prisma.lodging.findUniqueOrThrow({ where: { id: lodging.id } });
      expect(stored).toMatchObject({
        stars: 4,
        website: "https://www.kempinski.com/adlon",
        wikidataId: "Q698095",
        chainId,
        externalRef: "osm:way/123",
      });
    });

    it("writes nothing when the confirmed house is no longer the match", async () => {
      const lodging = await adlon();
      fetches = mockFetch([[/overpass-api\.de/, OVERPASS]]);
      const res = await request(app)
        .post(`/api/v1/lodging/${lodging.id}/enrich`)
        .set("Cookie", cookie)
        .send({ expectedOsmRef: "osm:node/999" });
      expect(res.body).toMatchObject({ found: false, reason: "matchChanged", filled: [] });
      const stored = await prisma.lodging.findUniqueOrThrow({ where: { id: lodging.id } });
      expect(stored).toMatchObject({ website: null, chainId: null, externalRef: null });
    });

    it("never replaces a reference the lodging already has", async () => {
      const lodging = await adlon({ externalRef: "google:ChIJabc" });
      fetches = mockFetch([[/overpass-api\.de/, OVERPASS]]);
      const res = await request(app)
        .post(`/api/v1/lodging/${lodging.id}/enrich`)
        .set("Cookie", cookie);
      expect(res.body.referenceStored).toBe(false);
      const stored = await prisma.lodging.findUniqueOrThrow({ where: { id: lodging.id } });
      expect(stored.externalRef).toBe("google:ChIJabc");
      expect(stored.website).toBe("https://www.kempinski.com/adlon");
    });

    it("still works without a body, as before the preview existed", async () => {
      const lodging = await adlon();
      fetches = mockFetch([[/overpass-api\.de/, OVERPASS]]);
      const res = await request(app)
        .post(`/api/v1/lodging/${lodging.id}/enrich`)
        .set("Cookie", cookie);
      expect(res.body).toMatchObject({ found: true, osmRef: "osm:way/123" });
    });

    it("refuses a malformed expectedOsmRef", async () => {
      const lodging = await adlon();
      fetches = mockFetch([]);
      const res = await request(app)
        .post(`/api/v1/lodging/${lodging.id}/enrich`)
        .set("Cookie", cookie)
        .send({ expectedOsmRef: "way 123" });
      expect(res.status).toBe(400);
      expect(fetches.calls).toHaveLength(0);
    });
  });
});
