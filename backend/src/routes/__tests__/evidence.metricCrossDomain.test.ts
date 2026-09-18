import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  assertDistinctInvariant,
  assertSumInvariant,
} from "../../services/evidence/__tests__/invariants";
import { foldCrossDomain } from "../../shared/crossDomainCounting";

/**
 * `metric` evidence for the three `CrossDomainKpis` tiles (task-7b-2-brief.md)
 * — the only measures in the registry scoped `domainFiltered`, because they
 * are the only numbers on the site that move when a domain chip is toggled.
 *
 * There is no endpoint to cross-check against: the strip's calculator is a
 * CLIENT fold (`Overview/aggregate.ts`) over four rollup endpoints, and
 * asking those four here would compare the resolver to a second copy of its
 * own arithmetic rather than to the tile. The guard is instead the one the
 * brief names — the last test runs `foldCrossDomain`, the module
 * `aggregate()` itself folds with, over the fixture's own contributions and
 * requires each measure to agree with it. What the literals below carry is
 * the POPULATION: which rows count, which year they fall in, and which days
 * and countries they prove.
 *
 * The fixture, all of it user A's, all of it 2024 unless stated:
 *   - FRA → LHR on 10 March (one flight; Germany and the United Kingdom)
 *   - FRA → MUC on 10 March, the SAME day (a second event, no second day)
 *   - a cruise 30 Dec 2024 → 2 Jan 2025 (one event filed under 2024, four
 *     active days split across two years)
 *   - a stay 10–12 March at a German hotel (an event on a day the flights
 *     already claimed, and a country they already proved)
 *   - a place in Japan with two visits, 1 May and 2 May
 *   - a place in Italy marked visited with NO visit at all — a country with
 *     no experience behind it
 */
describe("GET /api/v1/evidence/metric/... — the cross-domain KPI strip", () => {
  let userId: string;
  let cookie: string;

  interface EvidenceBody {
    measure: { value: number | null; unit: string; aggregation: string };
    entries: Array<{
      id: string;
      domain: string;
      credits?: string[];
      contribution?: number;
    }>;
    omitted: { count: number; contribution?: number; credits?: number };
    unattributed: Array<{ count: number; reason: string }>;
  }

  const KEYS = [
    "crossDomainEventCount",
    "crossDomainCountryCount",
    "crossDomainActiveDayCount",
  ] as const;

  const lifetime = new Map<string, EvidenceBody>();
  const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidencecrossdomain" } });
    const user = await prisma.user.create({
      data: { username: "evidencecrossdomain", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    await prisma.flight.createMany({
      data: [
        {
          userId,
          depIata: "FRA",
          arrIata: "LHR",
          depLat: 50.030241,
          depLon: 8.561096,
          arrLat: 51.4706,
          arrLon: -0.461941,
          status: "flown",
          flightNumber: "CD100",
          departureTime: new Date("2024-03-10T09:00:00Z"),
          arrivalTime: new Date("2024-03-10T10:30:00Z"),
        },
        {
          userId,
          depIata: "FRA",
          arrIata: "MUC",
          depLat: 50.030241,
          depLon: 8.561096,
          arrLat: 48.353802,
          arrLon: 11.7861,
          status: "flown",
          flightNumber: "CD200",
          departureTime: new Date("2024-03-10T17:00:00Z"),
          arrivalTime: new Date("2024-03-10T18:00:00Z"),
        },
      ],
    });

    await prisma.cruise.create({
      data: {
        userId,
        status: "flown",
        routeName: "Silvester auf See",
        startDate: day("2024-12-30"),
        endDate: day("2025-01-02"),
      },
    });

    const lodging = await prisma.lodging.create({
      data: {
        userId,
        name: "Hotel Rheinblick",
        type: "hotel",
        country: "Germany",
        isoCountryCode: "DE",
      },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        status: "completed",
        checkIn: day("2024-03-10"),
        checkOut: day("2024-03-12"),
      },
    });

    const japan = await prisma.place.create({
      data: {
        userId,
        name: "Fushimi Inari",
        category: "viewpoint",
        lat: 34.9671,
        lon: 135.7727,
        isoCountryCode: "JP",
        visited: true,
        visits: {
          create: [
            { userId, visitedAt: day("2024-05-01") },
            { userId, visitedAt: day("2024-05-02") },
          ],
        },
      },
    });
    expect(japan.id).toBeTruthy();

    await prisma.place.create({
      data: {
        userId,
        name: "Ponte Vecchio",
        category: "landmark",
        lat: 43.768,
        lon: 11.2531,
        isoCountryCode: "IT",
        visited: true,
      },
    });

    for (const key of KEYS) {
      const res = await request(app).get(`/api/v1/evidence/metric/${key}`).set("Cookie", cookie);
      expect([key, res.status]).toEqual([key, 200]);
      lifetime.set(key, res.body as EvidenceBody);
    }
  });

  afterAll(async () => {
    await prisma.placeVisit.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const answer = (key: (typeof KEYS)[number]): EvidenceBody => lifetime.get(key)!;

  /**
   * Two flights, one cruise, one stay and two place VISITS — the visitless
   * Italian place is a country and not an experience, which is the split
   * `adaptPoi` makes between `counted` places and `totalVisits`.
   */
  it("crossDomainEventCount: six experiences, one row each", () => {
    const res = answer("crossDomainEventCount");
    expect(res.measure.value).toBe(6);
    expect(res.measure.unit).toBe("events");
    expect(res.entries.every((e) => e.contribution === 1)).toBe(true);
    expect(res.entries.filter((e) => e.domain === "place")).toHaveLength(2);
    assertSumInvariant(res, Math.round);
  });

  /**
   * DE, GB, JP, IT — four, not five: the hotel's Germany is the flights'
   * Germany. A sum of the four domains' own country counts would say five.
   */
  it("crossDomainCountryCount: the UNION, so Germany is proved twice and counted once", () => {
    const res = answer("crossDomainCountryCount");
    expect(res.measure.value).toBe(4);
    expect(res.measure.aggregation).toBe("distinct");
    const credited = new Set(res.entries.flatMap((e) => e.credits ?? []));
    expect([...credited].sort()).toEqual(["DE", "GB", "IT", "JP"]);
    // One international flight proves TWO countries; that is what `credits`
    // exists to express and a scalar per row could not.
    const international = res.entries.find((e) => (e.credits ?? []).includes("GB"))!;
    expect([...international.credits!].sort()).toEqual(["DE", "GB"]);
    assertDistinctInvariant(res);
  });

  /**
   * 10, 11 March (the stay's two nights, the first shared with both
   * flights), 1 and 2 May, and 30, 31 Dec plus 1, 2 Jan from the cruise —
   * eight. The two flights add no day of their own: they departed on a day
   * the stay already covers, which is exactly the double count the union
   * removes.
   */
  it("crossDomainActiveDayCount: eight distinct days, a shared one counted once", () => {
    const res = answer("crossDomainActiveDayCount");
    expect(res.measure.value).toBe(8);
    expect(res.measure.unit).toBe("days");
    const days = new Set(res.entries.flatMap((e) => e.credits ?? []));
    expect([...days].sort()).toEqual([
      "2024-03-10",
      "2024-03-11",
      "2024-05-01",
      "2024-05-02",
      "2024-12-30",
      "2024-12-31",
      "2025-01-01",
      "2025-01-02",
    ]);
    assertDistinctInvariant(res);
  });

  /**
   * The chips are the population. Asking for flights alone must answer with
   * flights alone — a resolver that ignored `domains` would pass every other
   * test in this file.
   */
  it("narrows to the toggled domains, and only those", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/crossDomainEventCount")
      .query({ domains: "flight" })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(2);
    expect(res.body.scope).toBeUndefined();
    expect(res.body.measure.scope.domains).toEqual(["flight"]);
    assertSumInvariant(res.body, Math.round);
  });

  /**
   * A cruise is ONE experience, in the year it began — but its days land in
   * the years they actually happened in. The two rules disagree on purpose
   * and `aggregate()` says so; this is the case that separates them.
   */
  it("files a New Year cruise's event in 2024 and its days in both years", async () => {
    const events2025 = await request(app)
      .get("/api/v1/evidence/metric/crossDomainEventCount")
      .query({ period: "year", year: 2025 })
      .set("Cookie", cookie);
    expect(events2025.status).toBe(200);
    expect(events2025.body.measure.value).toBe(0);

    const days2025 = await request(app)
      .get("/api/v1/evidence/metric/crossDomainActiveDayCount")
      .query({ period: "year", year: 2025 })
      .set("Cookie", cookie);
    expect(days2025.status).toBe(200);
    expect(days2025.body.measure.value).toBe(2);
    expect(days2025.body.entries.map((e: { credits: string[] }) => e.credits)).toEqual([
      ["2025-01-01", "2025-01-02"],
    ]);
  });

  it("answers 400 for a rolling window the strip cannot show", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/crossDomainCountryCount")
      .query({ period: "rolling12m" })
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  /**
   * The population guard. `foldCrossDomain` is the module `aggregate()`
   * folds with, so running it here over the fixture's own contributions
   * compares each measure against the arithmetic the TILE performs — not
   * against a literal, and not against a second copy written for the test.
   */
  it("all three measures equal what the strip's own fold produces", () => {
    const totals = foldCrossDomain([
      {
        domain: "flight",
        events: 2,
        countries: ["DE", "GB", "DE"],
        activeDayKeys: ["2024-03-10", "2024-03-10"],
      },
      {
        domain: "cruise",
        events: 1,
        countries: [],
        activeDayKeys: ["2024-12-30", "2024-12-31", "2025-01-01", "2025-01-02"],
      },
      {
        domain: "lodging",
        events: 1,
        countries: ["DE"],
        activeDayKeys: ["2024-03-10", "2024-03-11"],
      },
      {
        domain: "poi",
        events: 2,
        countries: ["JP", "IT"],
        activeDayKeys: ["2024-05-01", "2024-05-02"],
      },
    ]);

    const pairs: Array<[(typeof KEYS)[number], number]> = [
      ["crossDomainEventCount", totals.totalEvents],
      ["crossDomainCountryCount", totals.countriesCount],
      ["crossDomainActiveDayCount", totals.activeDays],
    ];
    for (const [key, folded] of pairs) {
      // The key rides in the assertion so a failure names WHICH measure
      // diverged rather than printing two bare numbers.
      expect([key, answer(key).measure.value]).toEqual([key, folded]);
    }
  });
});
