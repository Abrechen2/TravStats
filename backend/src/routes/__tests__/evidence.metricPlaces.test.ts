import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  assertDistinctInvariant,
  assertSumInvariant,
} from "../../services/evidence/__tests__/invariants";

/**
 * `metric` evidence for the six served places-tab measures
 * (task-7b-3-brief.md).
 *
 * There is NO endpoint to cross-check against, and saying so is more useful
 * than inventing one: the places tab has no rollup, so its calculator is the
 * client fold `lib/stats/poiStatsDetail.ts` over `listPlaces`. Both sides read
 * `shared/placeCounting.ts` — including the year window, which moved there in
 * this task — and `frontend/src/lib/stats/__tests__/periodScope.test.ts`
 * pins the fold to that module from the other side. What the literals below
 * carry is the POPULATION: which places count, which visits count, and which
 * year each falls in.
 *
 * The fixture, all of it user A's:
 *   - Fushimi Inari (Japan, Kyoto), visited: two visits in May 2024 and one
 *     UNDATED. The undated one counts in the total and places the place in no
 *     year.
 *   - Brandenburger Tor (Germany, Berlin), visited: one visit in 2025.
 *   - Ponte Vecchio (Italy, Florence), marked visited with NO visit at all —
 *     a place that happened and that nobody can date.
 *   - Machu Picchu (Peru), a bare wishlist entry.
 *   - Uluru (Australia), a wishlist entry with a visit dated in 2027: planned
 *     is not visited, and a year may not run ahead of the lifetime figure.
 *   - Two lists: one of the user's own and one subscribed checklist.
 */
describe("GET /api/v1/evidence/metric/... — the places tab", () => {
  let userId: string;
  let cookie: string;
  let fushimiId: string;
  let brandenburgId: string;
  let ponteId: string;
  let machuId: string;
  let uluruId: string;
  let ownListId: string;
  let curatedListId: string;

  interface EvidenceBody {
    measure: { value: number | null; unit: string; aggregation: string };
    entries: Array<{
      id: string;
      domain: string;
      href: string | null;
      credits?: string[];
      contribution?: number;
    }>;
    omitted: { count: number; contribution?: number; credits?: number };
    unattributed: Array<{ count: number; reason: string }>;
  }

  const KEYS = [
    "placesVisitedCount",
    "placeVisitCount",
    "placeCountriesCount",
    "placeCitiesCount",
    "placeListCount",
    "placeWishlistCount",
  ] as const;

  const lifetime = new Map<string, EvidenceBody>();
  const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
  const answer = (key: (typeof KEYS)[number]): EvidenceBody => lifetime.get(key)!;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidenceplaces" } });
    const user = await prisma.user.create({
      data: { username: "evidenceplaces", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    const fushimi = await prisma.place.create({
      data: {
        userId,
        name: "Fushimi Inari",
        category: "viewpoint",
        lat: 34.9671,
        lon: 135.7727,
        city: "Kyoto",
        country: "Japan",
        isoCountryCode: "JP",
        visited: true,
        visits: {
          create: [
            { userId, visitedAt: day("2024-05-01") },
            { userId, visitedAt: day("2024-05-02") },
            // Undated: it happened, the user cannot say when. It counts in the
            // total and marks no year.
            { userId, visitedAt: null },
          ],
        },
      },
    });
    fushimiId = fushimi.id;

    const brandenburg = await prisma.place.create({
      data: {
        userId,
        name: "Brandenburger Tor",
        category: "landmark",
        lat: 52.5163,
        lon: 13.3777,
        city: "Berlin",
        country: "Germany",
        isoCountryCode: "DE",
        visited: true,
        visits: { create: [{ userId, visitedAt: day("2025-02-01") }] },
      },
    });
    brandenburgId = brandenburg.id;

    const ponte = await prisma.place.create({
      data: {
        userId,
        name: "Ponte Vecchio",
        category: "landmark",
        lat: 43.768,
        lon: 11.2531,
        city: "Florence",
        country: "Italy",
        isoCountryCode: "IT",
        visited: true,
      },
    });
    ponteId = ponte.id;

    const machu = await prisma.place.create({
      data: {
        userId,
        name: "Machu Picchu",
        category: "landmark",
        lat: -13.1631,
        lon: -72.545,
        city: "Cusco",
        country: "Peru",
        isoCountryCode: "PE",
        visited: false,
      },
    });
    machuId = machu.id;

    const uluru = await prisma.place.create({
      data: {
        userId,
        name: "Uluru",
        category: "nature",
        lat: -25.3444,
        lon: 131.0369,
        country: "Australia",
        isoCountryCode: "AU",
        visited: false,
        visits: { create: [{ userId, visitedAt: day("2027-09-01") }] },
      },
    });
    uluruId = uluru.id;

    const ownList = await prisma.placeList.create({ data: { userId, name: "Maccis" } });
    ownListId = ownList.id;
    const curated = await prisma.placeList.create({
      data: { userId, name: "Neue 7 Weltwunder", curatedKey: "world-wonders-new7" },
    });
    curatedListId = curated.id;

    for (const key of KEYS) {
      const res = await request(app).get(`/api/v1/evidence/metric/${key}`).set("Cookie", cookie);
      expect([key, res.status]).toEqual([key, 200]);
      lifetime.set(key, res.body as EvidenceBody);
    }
  });

  afterAll(async () => {
    await prisma.placeVisit.deleteMany({ where: { userId } });
    await prisma.placeList.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /**
   * Three places, and one of them has never been dated. `Place.visited` is the
   * whole question here — a place can be visited with zero visit rows ("I have
   * definitely been to that Maccis, no idea when") and it still counts.
   */
  it("placesVisitedCount: the three in the logbook, including the undatable one", () => {
    const res = answer("placesVisitedCount");
    expect(res.measure.value).toBe(3);
    expect(res.measure.aggregation).toBe("distinct");
    expect(res.entries.map((e) => e.id).sort()).toEqual([fushimiId, brandenburgId, ponteId].sort());
    expect(res.entries.every((e) => e.domain === "place")).toBe(true);
    expect(res.entries.find((e) => e.id === fushimiId)!.href).toBe(`/places/${fushimiId}`);
    assertDistinctInvariant(res);
  });

  /**
   * Four visits over three places — the other half of the split the
   * Place/PlaceVisit tables exist to make. The entry is the VISIT, so three
   * trips to Fushimi Inari are three rows pointing at one page, and the
   * visitless Ponte Vecchio contributes none.
   */
  it("placeVisitCount: four visits, one of them undated, none of them Uluru's", () => {
    const res = answer("placeVisitCount");
    expect(res.measure.value).toBe(4);
    expect(res.entries).toHaveLength(4);
    expect(res.entries.filter((e) => e.href === `/places/${fushimiId}`)).toHaveLength(3);
    expect(res.entries.every((e) => e.contribution === 1)).toBe(true);
    // Every id is a VISIT id, not a place id — a resolver keyed by place would
    // collapse the three Kyoto visits into one row.
    expect(new Set(res.entries.map((e) => e.id)).size).toBe(4);
    expect(res.entries.map((e) => e.id)).not.toContain(fushimiId);
    assertSumInvariant(res, Math.round);
  });

  it("placeCountriesCount: Japan, Germany, Italy — never Peru or Australia", () => {
    const res = answer("placeCountriesCount");
    expect(res.measure.value).toBe(3);
    const credited = new Set(res.entries.flatMap((e) => e.credits ?? []));
    expect([...credited].sort()).toEqual(["DE", "IT", "JP"]);
    assertDistinctInvariant(res);
  });

  /** Uluru has no city at all, and it is not in the population anyway. */
  it("placeCitiesCount: Kyoto, Berlin, Florence", () => {
    const res = answer("placeCitiesCount");
    expect(res.measure.value).toBe(3);
    const credited = new Set(res.entries.flatMap((e) => e.credits ?? []));
    expect([...credited].sort()).toEqual(["Berlin", "Florence", "Kyoto"]);
    assertDistinctInvariant(res);
  });

  /**
   * Both lists, and a subscribed checklist links to its OWN route rather than
   * to the subscription row's — which is the page that actually renders it.
   */
  it("placeListCount: the user's own list and the checklist they follow", () => {
    const res = answer("placeListCount");
    expect(res.measure.value).toBe(2);
    expect(res.entries.map((e) => e.id).sort()).toEqual([ownListId, curatedListId].sort());
    expect(res.entries.find((e) => e.id === ownListId)!.href).toBe(`/places/lists/${ownListId}`);
    expect(res.entries.find((e) => e.id === curatedListId)!.href).toBe(
      "/places/checklists/world-wonders-new7"
    );
    assertSumInvariant(res, Math.round);
  });

  /**
   * Two, and the second is the case worth having: Uluru carries a visit dated
   * in 2027, and a dated future visit is planned rather than visited. The fold
   * counts it as `places.length - visitedPlaces.length`, so it belongs here.
   */
  it("placeWishlistCount: the bare wish and the one with a date in the future", () => {
    const res = answer("placeWishlistCount");
    expect(res.measure.value).toBe(2);
    expect(res.entries.map((e) => e.id).sort()).toEqual([machuId, uluruId].sort());
    assertSumInvariant(res, Math.round);
  });

  /**
   * A year holds only what it can date. Fushimi Inari's two May visits put it
   * in 2024; its undated third does not, Brandenburger Tor belongs to 2025,
   * and Ponte Vecchio — visited, never dated — belongs to no year at all.
   */
  it("narrows to the year a visit is dated in, and drops what cannot be dated", async () => {
    const places = await request(app)
      .get("/api/v1/evidence/metric/placesVisitedCount")
      .query({ period: "year", year: 2024 })
      .set("Cookie", cookie);
    expect(places.status).toBe(200);
    expect(places.body.measure.value).toBe(1);
    expect(places.body.entries.map((e: { id: string }) => e.id)).toEqual([fushimiId]);

    const visits = await request(app)
      .get("/api/v1/evidence/metric/placeVisitCount")
      .query({ period: "year", year: 2024 })
      .set("Cookie", cookie);
    expect(visits.status).toBe(200);
    expect(visits.body.measure.value).toBe(2);

    const countries = await request(app)
      .get("/api/v1/evidence/metric/placeCountriesCount")
      .query({ period: "year", year: 2025 })
      .set("Cookie", cookie);
    expect(countries.status).toBe(200);
    expect(countries.body.measure.value).toBe(1);
  });

  /**
   * Lists and the wishlist answer for the whole logbook. The tab draws both
   * tiles only when no year is selected, so a year is a 400 rather than a
   * lifetime figure wearing a year's label.
   */
  it("refuses a year for the two measures that have none", async () => {
    for (const key of ["placeListCount", "placeWishlistCount"]) {
      const res = await request(app)
        .get(`/api/v1/evidence/metric/${key}`)
        .query({ period: "year", year: 2024 })
        .set("Cookie", cookie);
      expect([key, res.status]).toEqual([key, 400]);
    }
  });

  it("answers 400 for a rolling window the tab cannot show", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/placeVisitCount")
      .query({ period: "rolling12m" })
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });
});
