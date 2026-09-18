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
 * `metric` evidence for the seven served `StatsFunSection` tiles
 * (task-7b-1-brief.md).
 *
 * The literals below name what each measure is FOR — a morning departure, a
 * 300 km hop — so a failure says which rule broke. What proves the
 * POPULATION is the last test, which asks `/stats/fun` in the same run what
 * it renders and requires every one of the seven to agree: the sum and
 * distinct invariants cannot do that job, because `value` and `omitted` come
 * from the same total and hold for any population whatsoever
 * (`services/evidence/__tests__/invariants.ts` says so at the top).
 *
 * The clocks are read at the DEPARTURE airport, so every expectation here is
 * a Berlin one: June is CEST, two hours ahead of the stored UTC instant.
 */
describe("GET /api/v1/evidence/metric/... — the flight-tab fun family", () => {
  let userAId: string;
  let userACookie: string;
  let userBId: string;
  let userBCookie: string;

  const FRA = { depIata: "FRA", depLat: 50.030241, depLon: 8.561096 };

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["evidencefunA", "evidencefunB"] } },
    });
    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: { username: "evidencefunA", passwordHash: await hashPassword("password123") },
      }),
      prisma.user.create({
        data: { username: "evidencefunB", passwordHash: await hashPassword("password123") },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    userACookie = `auth_token=${generateToken(userA.id)}`;
    userBCookie = `auth_token=${generateToken(userB.id)}`;

    await prisma.flight.createMany({
      data: [
        // 08:00 in Berlin — the early bird. ~650 km: neither distance band.
        {
          userId: userAId,
          ...FRA,
          arrIata: "LHR",
          arrLat: 51.4706,
          arrLon: -0.461941,
          departureTime: new Date("2025-06-10T06:00:00Z"),
          arrivalTime: new Date("2025-06-10T07:30:00Z"),
          status: "flown",
          flightNumber: "FN100",
          seatClass: "economy",
        },
        // 22:00 in Berlin — the night owl. 6200 km: long haul.
        {
          userId: userAId,
          ...FRA,
          arrIata: "JFK",
          arrLat: 40.639447,
          arrLon: -73.779317,
          departureTime: new Date("2025-06-11T20:00:00Z"),
          arrivalTime: new Date("2025-06-12T02:00:00Z"),
          status: "flown",
          flightNumber: "FN200",
          seatClass: "business",
        },
        // Saturday 12:00 in Berlin — the weekend warrior. ~300 km: short haul.
        {
          userId: userAId,
          ...FRA,
          arrIata: "MUC",
          arrLat: 48.353802,
          arrLon: 11.7861,
          departureTime: new Date("2025-06-14T10:00:00Z"),
          arrivalTime: new Date("2025-06-14T11:00:00Z"),
          status: "flown",
          flightNumber: "FN300",
          seatClass: "economy",
        },
        // Countable but NOT `flown`: it must count toward the distance
        // bands, the CO2 total and the timezone union, and toward none of
        // the three clock-reading counts — the split `calculateFunStats`
        // makes between its two input sets. Deliberately placed at 08:00 on
        // a SATURDAY in London, so it would land in the early-bird AND the
        // weekend count if that split were ever dropped; a mid-week noon
        // row would have let the mistake through.
        {
          userId: userAId,
          depIata: "LHR",
          depLat: 51.4706,
          depLon: -0.461941,
          arrIata: "FRA",
          arrLat: 50.030241,
          arrLon: 8.561096,
          departureTime: new Date("2024-03-09T08:00:00Z"),
          arrivalTime: new Date("2024-03-09T09:30:00Z"),
          status: "historical",
          flightNumber: "FN400",
        },
        // Excluded by `countableFlightWhere()` — a Singapore route that
        // would otherwise add a timezone, a long haul and a large CO2 figure.
        {
          userId: userAId,
          ...FRA,
          arrIata: "SIN",
          arrLat: 1.35019,
          arrLon: 103.994003,
          departureTime: new Date("2025-06-20T06:00:00Z"),
          arrivalTime: new Date("2025-06-20T18:00:00Z"),
          status: "cancelled",
          flightNumber: "FN999",
        },
      ],
    });

    // User B's own single flight — the cross-user probe.
    await prisma.flight.create({
      data: {
        userId: userBId,
        ...FRA,
        arrIata: "LHR",
        arrLat: 51.4706,
        arrLon: -0.461941,
        departureTime: new Date("2025-01-15T06:00:00Z"),
        arrivalTime: new Date("2025-01-15T07:30:00Z"),
        status: "flown",
        flightNumber: "FB100",
      },
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  });

  const get = (key: string, cookie = userACookie) =>
    request(app).get(`/api/v1/evidence/metric/${key}`).set("Cookie", cookie);

  it("earlyBirdFlightCount: the 08:00 Berlin departure, and only it", async () => {
    const res = await get("earlyBirdFlightCount");
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
    expect(res.body.entries.map((e: { title: { text: string } }) => e.title.text)).toEqual([
      "FN100",
    ]);
    assertSumInvariant(res.body, Math.round);
  });

  it("nightOwlFlightCount: the 22:00 Berlin departure", async () => {
    const res = await get("nightOwlFlightCount");
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
    expect(res.body.entries.map((e: { title: { text: string } }) => e.title.text)).toEqual([
      "FN200",
    ]);
    assertSumInvariant(res.body, Math.round);
  });

  it("weekendFlightCount: the Saturday departure — and the historical row is not in it", async () => {
    const res = await get("weekendFlightCount");
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
    expect(res.body.entries.map((e: { title: { text: string } }) => e.title.text)).toEqual([
      "FN300",
    ]);
    assertSumInvariant(res.body, Math.round);
  });

  it("shortHaulFlightCount: the 300 km hop, not the 650 km one", async () => {
    const res = await get("shortHaulFlightCount");
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
    expect(res.body.entries.map((e: { title: { text: string } }) => e.title.text)).toEqual([
      "FN300",
    ]);
    assertSumInvariant(res.body, Math.round);
  });

  it("longHaulFlightCount: the transatlantic one, and not the cancelled Singapore route", async () => {
    const res = await get("longHaulFlightCount");
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
    expect(res.body.entries.map((e: { title: { text: string } }) => e.title.text)).toEqual([
      "FN200",
    ]);
    assertSumInvariant(res.body, Math.round);
  });

  /**
   * The one fun measure whose rows contribute something other than 1. The
   * business-class transatlantic flight must contribute the largest share by
   * far — a per-flight figure that ignored the cabin would make it roughly a
   * third of what it is, and the total would still look plausible.
   */
  it("co2FootprintKg: every countable flight contributes its own estimate, cabin included", async () => {
    const res = await get("co2FootprintKg");
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(4);
    const byFlight = new Map<string, number>(
      res.body.entries.map((e: { title: { text: string }; contribution: number }) => [
        e.title.text,
        e.contribution,
      ])
    );
    expect(byFlight.get("FN200")).toBeGreaterThan(3 * (byFlight.get("FN100") ?? 0));
    expect(res.body.measure.value).toBe([...byFlight.values()].reduce((sum, kg) => sum + kg, 0));
    assertSumInvariant(res.body, Math.round);
  });

  /**
   * `timezoneHopperFlightCount` is a DISTINCT count of timezones — the
   * registry called it `sum` / `flights` until this task, which described
   * neither the number nor its unit. Berlin, London and New York: three,
   * over four flights, with the Singapore zone kept out by the cancelled
   * row's exclusion.
   */
  it("timezoneHopperFlightCount: three zones across four flights, credited per flight", async () => {
    const res = await get("timezoneHopperFlightCount");
    expect(res.status).toBe(200);
    expect(res.body.measure.aggregation).toBe("distinct");
    expect(res.body.measure.unit).toBe("timezones");
    expect(res.body.measure.value).toBe(3);
    const domestic = res.body.entries.find(
      (e: { title: { text: string } }) => e.title.text === "FN300"
    );
    // FRA → MUC is one zone twice: the credit is a union, not a pair.
    expect(domestic.credits).toEqual(["Europe/Berlin"]);
    assertDistinctInvariant(res.body);
  });

  /**
   * The guard against a wrong population, and the only one there is: the
   * tile's own endpoint, asked in this test, for each of the seven.
   */
  it("all seven fun measures equal the numbers /stats/fun renders", async () => {
    const fun = await request(app).get("/api/v1/stats/fun").set("Cookie", userACookie);
    expect(fun.status).toBe(200);

    const pairs: Array<[string, number]> = [
      ["timezoneHopperFlightCount", fun.body.timezoneHopper],
      ["earlyBirdFlightCount", fun.body.earlyBird],
      ["nightOwlFlightCount", fun.body.nightOwl],
      ["weekendFlightCount", fun.body.weekendWarrior],
      ["shortHaulFlightCount", fun.body.shortHaulKing],
      ["longHaulFlightCount", fun.body.longHaulPilot],
      ["co2FootprintKg", fun.body.co2FootprintKg],
    ];
    for (const [key, rendered] of pairs) {
      const res = await get(key);
      expect(res.status).toBe(200);
      // The key rides in the assertion so a failure names WHICH measure
      // diverged rather than printing two bare numbers.
      expect([key, res.body.measure.value]).toEqual([key, rendered]);
    }
  });

  it("answers 400 for a year scope none of these tiles can show", async () => {
    const res = await get("shortHaulFlightCount").query({ period: "year", year: 2025 });
    expect(res.status).toBe(400);
  });

  it("never counts user A's flights into user B's own answer", async () => {
    const res = await get("earlyBirdFlightCount", userBCookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
    expect(res.body.entries.map((e: { title: { text: string } }) => e.title.text)).toEqual([
      "FB100",
    ]);
  });
});
