import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { clearWikipediaCache } from "../../services/openData/wikipedia";
import { clearPlaceWikidataMisses } from "../../services/openData/placeWikidata";
import { mockFetch, type FetchMock } from "../../services/openData/__tests__/fetchMock";

/**
 * Open data endpoints (2026-09-24): the switch, the journal's weather, the
 * planned profile, Wikipedia for a place, and the OpenStreetMap enrichment of
 * a lodging. `fetch` is replaced for every test — nothing here reaches a real
 * service, and a URL the test did not expect fails it.
 */

const STAVANGER_DAY = {
  daily: {
    time: ["2024-07-15"],
    weather_code: [53],
    temperature_2m_max: [17.7],
    temperature_2m_min: [10.9],
    precipitation_sum: [0.7],
  },
};

describe("open data endpoints", () => {
  let cookie: string;
  let userId: string;
  let otherCookie: string;
  let settingsId: number;
  let previousSwitch: boolean;
  let fetches: FetchMock | null = null;

  const setSwitch = (on: boolean) =>
    prisma.adminSettings.update({ where: { id: settingsId }, data: { openDataEnabled: on } });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["opendata1", "opendata2"] } } });
    const u = await prisma.user.create({
      data: { username: "opendata1", passwordHash: await hashPassword("password123") },
    });
    const other = await prisma.user.create({
      data: { username: "opendata2", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    otherCookie = `auth_token=${generateToken(other.id)}`;
    const settings =
      (await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } })) ??
      (await prisma.adminSettings.create({ data: {} }));
    settingsId = settings.id;
    previousSwitch = settings.openDataEnabled;
  });

  beforeEach(async () => {
    clearWikipediaCache();
    clearPlaceWikidataMisses();
    await setSwitch(true);
  });

  afterEach(() => {
    fetches?.restore();
    fetches = null;
  });

  afterAll(async () => {
    await setSwitch(previousSwitch);
    await prisma.user.deleteMany({ where: { username: { in: ["opendata1", "opendata2"] } } });
    await prisma.$disconnect();
  });

  async function tripWithStavanger(): Promise<string> {
    const trip = await prisma.trip.create({ data: { userId, name: "Norwegen" } });
    await prisma.tripStop.create({
      data: {
        tripId: trip.id,
        title: "Stavanger",
        lat: 58.97,
        lon: 5.73,
        startDate: new Date("2024-07-14T00:00:00Z"),
        endDate: new Date("2024-07-16T00:00:00Z"),
      },
    });
    return trip.id;
  }

  describe("the day's weather in the journal", () => {
    it("measures a new entry at the stop that covers its day", async () => {
      fetches = mockFetch([[/archive-api\.open-meteo\.com/, STAVANGER_DAY]]);
      const tripId = await tripWithStavanger();
      const res = await request(app)
        .post(`/api/v1/trips/${tripId}/journal`)
        .set("Cookie", cookie)
        .send({ date: "2024-07-15", body: "Preikestolen" });
      expect(res.status).toBe(201);
      expect(res.body.entry.observedWeather).toMatchObject({
        place: "Stavanger",
        code: 53,
        tMaxC: 17.7,
        source: "open-meteo",
      });
    });

    it("gives no weather to a day no stop covers, and clears it when the date moves there", async () => {
      fetches = mockFetch([[/archive-api\.open-meteo\.com/, STAVANGER_DAY]]);
      const tripId = await tripWithStavanger();
      const created = await request(app)
        .post(`/api/v1/trips/${tripId}/journal`)
        .set("Cookie", cookie)
        .send({ date: "2024-07-15", body: "x" });
      const moved = await request(app)
        .patch(`/api/v1/trips/${tripId}/journal/${created.body.entry.id}`)
        .set("Cookie", cookie)
        .send({ date: "2024-07-20" });
      expect(moved.status).toBe(200);
      expect(moved.body.entry.observedWeather).toBeNull();
    });

    it("asks nobody while the switch is off, and says so on an explicit request", async () => {
      await setSwitch(false);
      fetches = mockFetch([]);
      const tripId = await tripWithStavanger();
      const created = await request(app)
        .post(`/api/v1/trips/${tripId}/journal`)
        .set("Cookie", cookie)
        .send({ date: "2024-07-15", body: "x" });
      expect(created.body.entry.observedWeather).toBeNull();
      const fill = await request(app)
        .post(`/api/v1/trips/${tripId}/journal/weather`)
        .set("Cookie", cookie);
      expect(fill.status).toBe(409);
      expect(fill.body.error).toBe("openDataDisabled");
      expect(fetches.calls).toHaveLength(0);
    });

    it("fills every entry still without weather", async () => {
      await setSwitch(false);
      const tripId = await tripWithStavanger();
      await request(app)
        .post(`/api/v1/trips/${tripId}/journal`)
        .set("Cookie", cookie)
        .send({ date: "2024-07-15", body: "x" });
      await setSwitch(true);
      fetches = mockFetch([[/archive-api\.open-meteo\.com/, STAVANGER_DAY]]);
      const fill = await request(app)
        .post(`/api/v1/trips/${tripId}/journal/weather`)
        .set("Cookie", cookie);
      expect(fill.status).toBe(200);
      expect(fill.body.filled).toBe(1);
      expect(fill.body.entries[0].observedWeather.place).toBe("Stavanger");
    });
  });

  it("draws the planned profile of a tour from ground heights", async () => {
    const tour = await request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name: "Preikestolen", mode: "foot", activity: "hike" });
    const routeId = tour.body.route.id as string;
    await request(app)
      .put(`/api/v1/tours/${routeId}/points`)
      .set("Cookie", cookie)
      .send({
        points: [
          { title: "Parkplatz", lat: 58.9868, lon: 6.1903 },
          { title: "Gipfel", lat: 58.9864, lon: 6.1874 },
        ],
      });
    fetches = mockFetch([
      [
        /v1\/elevation/,
        (url: string) => {
          const n = new URL(url).searchParams.get("latitude")!.split(",").length;
          return { elevation: Array.from({ length: n }, (_, i) => 270 + (330 * i) / (n - 1)) };
        },
      ],
    ]);
    const res = await request(app)
      .get(`/api/v1/tours/${routeId}/planned-profile`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.profile.ascentM).toBe(330);
    expect(res.body.profile.profile[0]).toEqual([0, 270]);
  });

  it("finds a place's article through the wikidata tag of its OSM element, and remembers the item", async () => {
    const place = await prisma.place.create({
      data: {
        userId,
        name: "Brandenburger Tor",
        lat: 52.5163,
        lon: 13.3777,
        externalRef: "osm:node/42",
      },
    });
    fetches = mockFetch([
      [
        /api\.openstreetmap\.org\/api\/0\.6\/node\/42/,
        { elements: [{ tags: { wikidata: "Q82425" } }] },
      ],
      [
        /wikidata\.org/,
        { entities: { Q82425: { sitelinks: { dewiki: { title: "Brandenburger Tor" } } } } },
      ],
      [
        /de\.wikipedia\.org/,
        {
          type: "standard",
          title: "Brandenburger Tor",
          extract: "Das Brandenburger Tor ist ein Tor.",
          content_urls: { desktop: { page: "https://de.wikipedia.org/wiki/Brandenburger_Tor" } },
        },
      ],
    ]);
    const res = await request(app)
      .get(`/api/v1/places/${place.id}/wikipedia?lang=de`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ title: "Brandenburger Tor", thumbnailUrl: null });
    expect((await prisma.place.findUnique({ where: { id: place.id } }))?.wikidataId).toBe("Q82425");

    const foreign = await request(app)
      .get(`/api/v1/places/${place.id}/wikipedia?lang=de`)
      .set("Cookie", otherCookie);
    expect(foreign.status).toBe(404);
  });

  describe("places to sleep nearby (companion#12)", () => {
    const OVERPASS = {
      elements: [
        {
          type: "node",
          id: 11,
          lat: 62.09,
          lon: 6.87,
          tags: {
            name: "Hotel Union",
            tourism: "hotel",
            stars: "4S",
            brand: "Nearby Test Chain",
            website: "www.no-scheme.example",
          },
        },
        {
          type: "node",
          id: 12,
          lat: 62.0835,
          lon: 6.8668,
          tags: {
            name: "Hellesylt Camping",
            tourism: "camp_site",
            website: "https://camping.example",
          },
        },
        {
          type: "way",
          id: 13,
          center: { lat: 62.0834, lon: 6.8669 },
          tags: { name: "Bobil", tourism: "caravan_site" },
        },
        { type: "node", id: 14, lat: 62.1, lon: 6.9, tags: { tourism: "camp_site" } },
      ],
    };

    it("lists them nearest first, named ones only, with a website where OSM has one", async () => {
      fetches = mockFetch([[/overpass-api\.de/, OVERPASS]]);
      const res = await request(app)
        .get("/api/v1/nearby/lodging?lat=62.0833&lon=6.8667&radiusKm=3")
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.places.map((p: { name: string }) => p.name)).toEqual([
        "Bobil",
        "Hellesylt Camping",
        "Hotel Union",
      ]);
      expect(res.body.places[1].website).toBe("https://camping.example/");
    });

    it("gives the lodging form what it fills from: stars, and the catalogue chain of the brand", async () => {
      await prisma.lodgingChain.upsert({
        where: { name: "Nearby Test Chain" },
        update: {},
        create: { name: "Nearby Test Chain", loyaltyProgram: "Nearby Rewards" },
      });
      fetches = mockFetch([[/overpass-api\.de/, OVERPASS]]);
      const res = await request(app)
        .get("/api/v1/nearby/lodging?lat=62.0833&lon=6.8667&radiusKm=3")
        .set("Cookie", cookie);
      const hotel = res.body.places.find((p: { name: string }) => p.name === "Hotel Union");
      expect(hotel).toMatchObject({
        stars: 4,
        brand: "Nearby Test Chain",
        // Same rule as the enrichment: no scheme, no website.
        website: null,
        chain: { name: "Nearby Test Chain", loyaltyProgram: "Nearby Rewards" },
      });
      const camping = res.body.places.find((p: { name: string }) => p.name === "Bobil");
      expect(camping).toMatchObject({ stars: null, brand: null, chain: null });
    });

    it("says openDataDisabled while the switch is off, and 502 when OSM does not answer", async () => {
      await setSwitch(false);
      fetches = mockFetch([]);
      const off = await request(app)
        .get("/api/v1/nearby/lodging?lat=62&lon=6")
        .set("Cookie", cookie);
      expect(off.status).toBe(409);
      await setSwitch(true);
      fetches.restore();
      fetches = mockFetch([[/overpass-api\.de/, { error: "busy" }, 504]]);
      const down = await request(app)
        .get("/api/v1/nearby/lodging?lat=62&lon=6")
        .set("Cookie", cookie);
      expect(down.status).toBe(502);
    });
  });

  describe("a lodging from OpenStreetMap (beta)", () => {
    const OVERPASS = {
      elements: [
        {
          type: "node",
          id: 1,
          lat: 52.5162,
          lon: 13.3801,
          tags: {
            name: "Adlon Kempinski",
            tourism: "hotel",
            stars: "5",
            brand: "Kempinski",
            wikidata: "Q698095",
            website: "https://www.kempinski.com/adlon",
          },
        },
        {
          type: "node",
          id: 2,
          lat: 52.5163,
          lon: 13.3799,
          tags: { name: "Hotel Nebenan", tourism: "hotel", stars: "3" },
        },
      ],
    };

    it("fills only the empty fields, from the house whose name agrees, and links a known chain", async () => {
      const chain = await prisma.lodgingChain.upsert({
        where: { name: "Kempinski" },
        update: {},
        create: { name: "Kempinski" },
      });
      const lodging = await prisma.lodging.create({
        data: {
          userId,
          type: "hotel",
          name: "Hotel Adlon Kempinski Berlin",
          lat: 52.5162,
          lon: 13.38,
          stars: 4,
        },
      });
      fetches = mockFetch([[/overpass-api\.de/, OVERPASS]]);
      const res = await request(app)
        .post(`/api/v1/lodging/${lodging.id}/enrich`)
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ found: true, osmRef: "osm:node/1" });
      expect(res.body.filled.sort()).toEqual(["chain", "website", "wikidataId"]);
      const stored = await prisma.lodging.findUniqueOrThrow({ where: { id: lodging.id } });
      expect(stored.stars).toBe(4); // the user's own value stays
      expect(stored.chainId).toBe(chain.id);
      expect(stored.wikidataId).toBe("Q698095");
    });

    it("finds nothing when no house nearby carries the name", async () => {
      const lodging = await prisma.lodging.create({
        data: { userId, type: "hotel", name: "Pension Sonnenschein", lat: 52.5162, lon: 13.38 },
      });
      fetches = mockFetch([[/overpass-api\.de/, OVERPASS]]);
      const res = await request(app)
        .post(`/api/v1/lodging/${lodging.id}/enrich`)
        .set("Cookie", cookie);
      expect(res.body).toMatchObject({ found: false, reason: "notFound", filled: [] });
    });

    it("refuses another user's lodging", async () => {
      const lodging = await prisma.lodging.create({
        data: { userId, type: "hotel", name: "Adlon", lat: 52.5162, lon: 13.38 },
      });
      fetches = mockFetch([]);
      const res = await request(app)
        .post(`/api/v1/lodging/${lodging.id}/enrich`)
        .set("Cookie", otherCookie);
      expect(res.status).toBe(404);
      expect(fetches.calls).toHaveLength(0);
    });
  });
});
