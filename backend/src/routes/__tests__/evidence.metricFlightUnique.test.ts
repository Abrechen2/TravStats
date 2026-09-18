import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  assertDistinctInvariant,
  assertSumInvariant,
} from "../../services/evidence/__tests__/invariants";
import type { EvidenceResponse } from "../../schemas/evidence";

/**
 * `metric` evidence for the fifteen served `StatsUniqueSection` tiles
 * (task-7b-1-brief.md).
 *
 * Six flights carry all fifteen measures between them, each one chosen for
 * the rule it is the only witness of: a transatlantic pair that is also the
 * one round trip, a Pacific leg that is the only date-line crossing, a
 * Singapore–Sydney leg that is the only equator crossing and the only
 * historical row, an Arctic leg, and a domestic hop.
 *
 * As in the fun suite, the literals name the rules and the last test proves
 * the POPULATION: it asks `/stats/unique` in the same run and requires all
 * fifteen to agree with what the tiles render.
 */
describe("GET /api/v1/evidence/metric/... — the flight-tab unique family", () => {
  let userAId: string;
  let userACookie: string;
  let userBId: string;
  let userBCookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["evidenceuniqueA", "evidenceuniqueB"] } },
    });
    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: { username: "evidenceuniqueA", passwordHash: await hashPassword("password123") },
      }),
      prisma.user.create({
        data: { username: "evidenceuniqueB", passwordHash: await hashPassword("password123") },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    userACookie = `auth_token=${generateToken(userA.id)}`;
    userBCookie = `auth_token=${generateToken(userB.id)}`;

    await prisma.flight.createMany({
      data: [
        // FRA → JFK. Departs 18:00 in Berlin and lands at 16:00 in New York:
        // the clock went backwards, so this is the time traveller. Same local
        // day at both ends, westward, international, 6200 km of ocean.
        {
          userId: userAId,
          depIata: "FRA",
          depLat: 50.030241,
          depLon: 8.561096,
          arrIata: "JFK",
          arrLat: 40.639447,
          arrLon: -73.779317,
          departureTime: new Date("2025-06-10T16:00:00Z"),
          arrivalTime: new Date("2025-06-10T20:00:00Z"),
          status: "flown",
          flightNumber: "UQ100",
        },
        // JFK → FRA, the return. Lands the next morning in Berlin, so it is
        // the midnight crosser; eastward; completes the one round trip.
        {
          userId: userAId,
          depIata: "JFK",
          depLat: 40.639447,
          depLon: -73.779317,
          arrIata: "FRA",
          arrLat: 50.030241,
          arrLon: 8.561096,
          departureTime: new Date("2025-06-15T22:00:00Z"),
          arrivalTime: new Date("2025-06-16T06:00:00Z"),
          status: "flown",
          flightNumber: "UQ200",
        },
        // FRA → MUC, the domestic hop. Eastward, same local day.
        {
          userId: userAId,
          depIata: "FRA",
          depLat: 50.030241,
          depLon: 8.561096,
          arrIata: "MUC",
          arrLat: 48.353802,
          arrLon: 11.7861,
          departureTime: new Date("2025-07-01T08:00:00Z"),
          arrivalTime: new Date("2025-07-01T09:00:00Z"),
          status: "flown",
          flightNumber: "UQ300",
        },
        // LAX → NRT: 258° of raw longitude difference, which is the date
        // line. Westward once folded, and a second midnight crossing.
        {
          userId: userAId,
          depIata: "LAX",
          depLat: 33.942501,
          depLon: -118.407997,
          arrIata: "NRT",
          arrLat: 35.764702,
          arrLon: 140.386002,
          departureTime: new Date("2025-08-01T10:00:00Z"),
          arrivalTime: new Date("2025-08-02T03:00:00Z"),
          status: "flown",
          flightNumber: "UQ400",
        },
        // KEF → SFJ: Kangerlussuaq is at 67°N, so this is the Arctic flight.
        // Westward, international, Europe to North America.
        {
          userId: userAId,
          depIata: "KEF",
          depLat: 63.985001,
          depLon: -22.6056,
          arrIata: "SFJ",
          arrLat: 67.010446,
          arrLon: -50.715294,
          departureTime: new Date("2025-09-05T09:00:00Z"),
          arrivalTime: new Date("2025-09-05T11:00:00Z"),
          status: "flown",
          flightNumber: "UQ500",
        },
        // SIN → SYD, HISTORICAL: countable, so it carries the equator
        // crossing, the hemisphere hop, the tropics and a second ocean
        // crossing — and it must stay out of every clock-reading count.
        {
          userId: userAId,
          depIata: "SIN",
          depLat: 1.35019,
          depLon: 103.994003,
          arrIata: "SYD",
          arrLat: -33.946098,
          arrLon: 151.177002,
          departureTime: new Date("2024-05-01T12:00:00Z"),
          arrivalTime: new Date("2024-05-01T20:00:00Z"),
          status: "historical",
          flightNumber: "UQ600",
        },
        // Excluded by `countableFlightWhere()`: a second FRA → JFK leg that
        // would otherwise turn the one round trip into two.
        {
          userId: userAId,
          depIata: "FRA",
          depLat: 50.030241,
          depLon: 8.561096,
          arrIata: "JFK",
          arrLat: 40.639447,
          arrLon: -73.779317,
          departureTime: new Date("2025-10-01T16:00:00Z"),
          arrivalTime: new Date("2025-10-01T20:00:00Z"),
          status: "cancelled",
          flightNumber: "UQ999",
        },
      ],
    });

    await prisma.flight.create({
      data: {
        userId: userBId,
        depIata: "FRA",
        depLat: 50.030241,
        depLon: 8.561096,
        arrIata: "MUC",
        arrLat: 48.353802,
        arrLon: 11.7861,
        departureTime: new Date("2025-02-02T08:00:00Z"),
        arrivalTime: new Date("2025-02-02T09:00:00Z"),
        status: "flown",
        flightNumber: "UB100",
      },
    });
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  });

  /**
   * Every measure is fetched ONCE and the tests read the stored answers.
   * Not an optimisation: `statsLimiter` allows 30 requests a minute per
   * user, and asking about fifteen measures inside fifteen tests plus a
   * cross-check pass exceeded that — the last tests answered 429, which is
   * a red suite that says nothing at all about the resolvers.
   */
  const answers = new Map<string, EvidenceResponse>();
  let rendered: Record<string, number>;

  const answer = (key: string): EvidenceResponse => {
    const body = answers.get(key);
    if (!body) throw new Error(`no stored answer for ${key}`);
    return body;
  };

  const titles = (body: EvidenceResponse): string[] =>
    body.entries.map((e) => ("text" in e.title ? e.title.text : "")).sort();

  beforeAll(async () => {
    const unique = await request(app).get("/api/v1/stats/unique").set("Cookie", userACookie);
    expect(unique.status).toBe(200);
    rendered = {
      timeTravelFlightCount: unique.body.timeTravelIndex,
      equatorCrossingCount: unique.body.equatorCrossings,
      arcticFlightCount: unique.body.arcticFlights,
      oceanCrossingCount: unique.body.oceanCrossings,
      hemisphereHopCount: unique.body.hemisphereHops,
      dateLineCrossingCount: unique.body.dateLineCrossings,
      continentsTouchedByFlightCount: unique.body.continentalExplorer,
      tropicsFlightCount: unique.body.tropicsTraveler,
      eastwardFlightCount: unique.body.eastWestBalance.eastward,
      westwardFlightCount: unique.body.eastWestBalance.westward,
      sameDayFlightCount: unique.body.sameDayFlights,
      midnightFlightCount: unique.body.midnightFlights,
      internationalFlightCount: unique.body.internationalVsDomestic.international,
      domesticFlightCount: unique.body.internationalVsDomestic.domestic,
      roundTripFlightCount: unique.body.roundTripMaster,
    };
    for (const key of Object.keys(rendered)) {
      const res = await request(app)
        .get(`/api/v1/evidence/metric/${key}`)
        .set("Cookie", userACookie);
      expect([key, res.status]).toEqual([key, 200]);
      answers.set(key, res.body as EvidenceResponse);
    }
  });

  it("equatorCrossingCount and hemisphereHopCount are one rule under two names", () => {
    const equator = answer("equatorCrossingCount");
    const hemisphere = answer("hemisphereHopCount");
    // Singapore is north of the equator and Sydney south of it. The two
    // tiles have shown the same number since they were written — see
    // `flightPredicates.ts` on why one predicate now serves both.
    expect(equator.measure.value).toBe(1);
    expect(titles(equator)).toEqual(["UQ600"]);
    expect(hemisphere.measure.value).toBe(equator.measure.value);
    expect(titles(hemisphere)).toEqual(titles(equator));
    assertSumInvariant(equator, Math.round);
    assertSumInvariant(hemisphere, Math.round);
  });

  it("arcticFlightCount: the leg that ENDS north of 66.5 degrees, not only one that crosses it", () => {
    const res = answer("arcticFlightCount");
    expect(res.measure.value).toBe(1);
    expect(titles(res)).toEqual(["UQ500"]);
    assertSumInvariant(res, Math.round);
  });

  it("oceanCrossingCount: every leg over 5000 km, the cancelled one excluded", () => {
    const res = answer("oceanCrossingCount");
    // The Pacific leg is 8800 km and therefore an ocean crossing as well as
    // the date-line one — the rule is a distance heuristic, not a coastline.
    expect(titles(res)).toEqual(["UQ100", "UQ200", "UQ400", "UQ600"]);
    expect(res.measure.value).toBe(4);
    assertSumInvariant(res, Math.round);
  });

  it("dateLineCrossingCount: the Pacific leg alone", () => {
    const res = answer("dateLineCrossingCount");
    expect(res.measure.value).toBe(1);
    expect(titles(res)).toEqual(["UQ400"]);
    assertSumInvariant(res, Math.round);
  });

  it("tropicsFlightCount: the leg with an end inside the tropics", () => {
    const res = answer("tropicsFlightCount");
    expect(res.measure.value).toBe(1);
    expect(titles(res)).toEqual(["UQ600"]);
    assertSumInvariant(res, Math.round);
  });

  it("eastward and westward split the countable set by FOLDED longitude", () => {
    const east = answer("eastwardFlightCount");
    const west = answer("westwardFlightCount");
    expect(titles(east)).toEqual(["UQ200", "UQ300", "UQ600"]);
    // UQ400 is westward although its raw longitude difference is positive
    // and large — the date line is folded out before the direction is read.
    expect(titles(west)).toEqual(["UQ100", "UQ400", "UQ500"]);
    assertSumInvariant(east, Math.round);
    assertSumInvariant(west, Math.round);
  });

  it("continentsTouchedByFlightCount: a domestic hop credits ONE continent, not two", () => {
    const res = answer("continentsTouchedByFlightCount");
    expect(res.measure.aggregation).toBe("distinct");
    const domestic = res.entries.find((e) => "text" in e.title && e.title.text === "UQ300");
    expect(domestic?.credits).toEqual(["Europe"]);
    const transatlantic = res.entries.find((e) => "text" in e.title && e.title.text === "UQ100");
    expect([...(transatlantic?.credits ?? [])].sort()).toEqual(["Europe", "North America"]);
    assertDistinctInvariant(res);
  });

  it("internationalFlightCount and domesticFlightCount read the catalogue's countries", () => {
    const international = answer("internationalFlightCount");
    const domestic = answer("domesticFlightCount");
    expect(titles(domestic)).toEqual(["UQ300"]);
    expect(titles(international)).toEqual(["UQ100", "UQ200", "UQ400", "UQ500", "UQ600"]);
    assertSumInvariant(international, Math.round);
    assertSumInvariant(domestic, Math.round);
  });

  /**
   * The one measure in the family whose unit is not flights. Two legs make
   * one round trip, so each contributes 0.5 — and the cancelled second
   * outbound proves the pairing counts `min(there, back)` over the COUNTABLE
   * set rather than over everything with a matching route.
   */
  it("roundTripFlightCount: one round trip, evidenced by the two legs that made it", () => {
    const res = answer("roundTripFlightCount");
    expect(res.measure.unit).toBe("roundTrips");
    expect(res.measure.value).toBe(1);
    expect(titles(res)).toEqual(["UQ100", "UQ200"]);
    expect(res.entries.map((e) => e.contribution)).toEqual([0.5, 0.5]);
    assertSumInvariant(res, (n) => n);
  });

  /**
   * The time-travel rule compares MINUTES OF DAY and ignores the date, so
   * the eastbound return counts too: it leaves New York at 18:00 and lands
   * in Berlin at 08:00 the following morning, which is an earlier hour on
   * the clock. That is the calculator's own reading, and the panel mirrors
   * it rather than quietly correcting a figure the tile already shows.
   */
  it("timeTravelFlightCount: both legs whose local arrival HOUR precedes their departure", () => {
    const res = answer("timeTravelFlightCount");
    expect(titles(res)).toEqual(["UQ100", "UQ200"]);
    expect(res.measure.value).toBe(2);
    assertSumInvariant(res, Math.round);
  });

  it("sameDay and midnight partition the flown set, and the historical row is in neither", () => {
    const sameDay = answer("sameDayFlightCount");
    const midnight = answer("midnightFlightCount");
    expect(titles(sameDay)).toEqual(["UQ100", "UQ300", "UQ500"]);
    expect(titles(midnight)).toEqual(["UQ200", "UQ400"]);
    // Five flown rows, and UQ600 — historical, with times the app does not
    // trust — in neither.
    expect((sameDay.measure.value ?? 0) + (midnight.measure.value ?? 0)).toBe(5);
    assertSumInvariant(sameDay, Math.round);
    assertSumInvariant(midnight, Math.round);
  });

  /**
   * The guard against a wrong population, for all fifteen at once: every
   * literal above could be wrong together and this would still catch it,
   * because `calculateUniqueStats` is a second implementation of the same
   * rules and the two are asked in the same run.
   */
  it("all fifteen unique measures equal the numbers /stats/unique renders", () => {
    for (const [key, figure] of Object.entries(rendered)) {
      // The key rides in the assertion so a failure names WHICH measure
      // diverged rather than printing two bare numbers.
      expect([key, answer(key).measure.value]).toEqual([key, figure]);
    }
  });

  it("answers 400 for a rolling-12-month scope none of these tiles can show", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/oceanCrossingCount")
      .query({ period: "rolling12m" })
      .set("Cookie", userACookie);
    expect(res.status).toBe(400);
  });

  it("never counts user A's flights into user B's own answer", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/domesticFlightCount")
      .set("Cookie", userBCookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(1);
    expect(titles(res.body as EvidenceResponse)).toEqual(["UB100"]);
  });
});
