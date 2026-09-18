import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { assertSumInvariant } from "../../services/evidence/__tests__/invariants";

/**
 * `metric` evidence for the nine served `TravelAccountSection` measures
 * (task-7b-2-brief.md).
 *
 * The population guard is the LAST test: `/stats/travel-account` is asked in
 * the same run and every one of the nine has to equal the figure that
 * endpoint renders. That is a genuine guard here and not a formality — the
 * night resolvers read `attributeTravelNights` while the endpoint reads
 * `buildTravelAccount`'s YEAR ROWS, so the two arrive at each number by
 * different arithmetic (per-night attribution versus a per-year fold), and a
 * precedence rule applied in one and not the other shows up as a
 * disagreement rather than as two copies of the same mistake.
 *
 * Everything is loaded ONCE in `beforeAll`: `statsLimiter` allows 30 requests
 * a minute per user, and nine measures fetched per test would spend the
 * budget twice over.
 *
 * The fixture is a single 2024 year, deliberately closed so no figure moves
 * with the clock:
 *   - a cruise 05–12 June (7 nights at sea)
 *   - a hotel stay 08–10 June, INSIDE the cruise (2 contested nights, both
 *     awarded to the cabin)
 *   - a hotel stay 01–04 March (3 uncontested hotel nights)
 *   - a red-eye 20 September (1 night in the air)
 *   - a trip covering 01–04 March, fully covered by the March stay
 *   - a trip covering 01–05 October with nothing in it (4 uncovered days)
 */
describe("GET /api/v1/evidence/metric/... — the travel account", () => {
  let userAId: string;
  let userBId: string;
  let userACookie: string;
  let userBCookie: string;
  let lodgingId: string;
  let marchStayId: string;
  let juneStayId: string;
  let cruiseId: string;
  let coveredTripId: string;
  let gappedTripId: string;

  const KEYS = [
    "travelAccountHotelNights",
    "travelAccountSeaNights",
    "travelAccountAirNights",
    "travelAccountHomeNights",
    "travelAccountContestedNights",
    "travelAccountFullyCoveredTripCount",
    "travelAccountTripsWithDatesCount",
    "travelAccountUncoveredDayCount",
    "travelAccountJournalEntryCount",
  ] as const;

  interface EvidenceBody {
    measure: { value: number | null; unit: string; aggregation: string };
    entries: Array<{
      id: string;
      domain: string;
      href: string | null;
      title: { text?: string };
      subtitle: { key?: string } | null;
      contribution?: number;
    }>;
    unattributed: Array<{ count: number; reason: string }>;
    omitted: { count: number; contribution?: number };
  }

  const answers = new Map<string, EvidenceBody>();
  const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["evidencetravelacctA", "evidencetravelacctB"] } },
    });
    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: { username: "evidencetravelacctA", passwordHash: await hashPassword("password123") },
      }),
      prisma.user.create({
        data: { username: "evidencetravelacctB", passwordHash: await hashPassword("password123") },
      }),
    ]);
    userAId = userA.id;
    userBId = userB.id;
    userACookie = `auth_token=${generateToken(userA.id)}`;
    userBCookie = `auth_token=${generateToken(userB.id)}`;

    const lodging = await prisma.lodging.create({
      data: { userId: userAId, name: "Hotel Nordlicht", type: "hotel" },
    });
    lodgingId = lodging.id;

    const [march, june] = await Promise.all([
      prisma.lodgingStay.create({
        data: {
          userId: userAId,
          lodgingId,
          status: "completed",
          checkIn: day("2024-03-01"),
          checkOut: day("2024-03-04"),
        },
      }),
      prisma.lodgingStay.create({
        data: {
          userId: userAId,
          lodgingId,
          status: "completed",
          checkIn: day("2024-06-08"),
          checkOut: day("2024-06-10"),
        },
      }),
    ]);
    marchStayId = march.id;
    juneStayId = june.id;

    const cruise = await prisma.cruise.create({
      data: {
        userId: userAId,
        status: "completed",
        routeName: "Nordland",
        startDate: day("2024-06-05"),
        endDate: day("2024-06-12"),
      },
    });
    cruiseId = cruise.id;

    // A genuine night in the air, read on the clocks at either END and not in
    // UTC (AUD-079): 21:00 in Frankfurt on the 20th, landing 01:00 in New
    // York on the 21st. The first draft of this fixture departed at 22:00Z,
    // which is midnight in Frankfurt and therefore already the 21st — a
    // daytime hop by the account's own rule, and no night at all.
    await prisma.flight.create({
      data: {
        userId: userAId,
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50.030241,
        depLon: 8.561096,
        arrLat: 40.639447,
        arrLon: -73.779317,
        status: "flown",
        flightNumber: "TA100",
        departureTime: new Date("2024-09-20T19:00:00Z"),
        arrivalTime: new Date("2024-09-21T05:00:00Z"),
      },
    });

    const [covered, gapped] = await Promise.all([
      prisma.trip.create({
        data: {
          userId: userAId,
          name: "Harz im März",
          status: "completed",
          startDate: day("2024-03-01"),
          endDate: day("2024-03-04"),
          journalEntries: {
            create: [
              { date: day("2024-03-02"), body: "Regen", mood: "calm" },
              { date: day("2024-03-03"), body: "Sonne", mood: "happy" },
            ],
          },
        },
      }),
      prisma.trip.create({
        data: {
          userId: userAId,
          name: "Oktober ohne Belege",
          status: "completed",
          startDate: day("2024-10-01"),
          endDate: day("2024-10-05"),
        },
      }),
    ]);
    coveredTripId = covered.id;
    gappedTripId = gapped.id;
    await prisma.lodgingStay.update({
      where: { id: marchStayId },
      data: { tripId: coveredTripId },
    });

    // User B's own single stay — the cross-user probe.
    const otherLodging = await prisma.lodging.create({
      data: { userId: userBId, name: "Pension Anders", type: "hotel" },
    });
    await prisma.lodgingStay.create({
      data: {
        userId: userBId,
        lodgingId: otherLodging.id,
        status: "completed",
        checkIn: day("2024-02-01"),
        checkOut: day("2024-02-03"),
      },
    });

    for (const key of KEYS) {
      const res = await request(app)
        .get(`/api/v1/evidence/metric/${key}`)
        .set("Cookie", userACookie);
      expect([key, res.status]).toEqual([key, 200]);
      answers.set(key, res.body as EvidenceBody);
    }
  });

  afterAll(async () => {
    await prisma.lodgingStay.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.lodging.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.cruise.deleteMany({ where: { userId: userAId } });
    await prisma.flight.deleteMany({ where: { userId: userAId } });
    await prisma.trip.deleteMany({ where: { userId: userAId } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  });

  const answer = (key: (typeof KEYS)[number]): EvidenceBody => answers.get(key)!;

  it("travelAccountSeaNights: the whole cruise, including the nights a hotel also claimed", () => {
    const res = answer("travelAccountSeaNights");
    expect(res.measure.value).toBe(7);
    expect(res.measure.unit).toBe("nights");
    expect(res.entries.map((e) => e.id)).toEqual([cruiseId]);
    expect(res.entries[0].domain).toBe("cruise");
    expect(res.entries[0].href).toBe(`/cruises/${cruiseId}`);
    expect(res.entries[0].contribution).toBe(7);
    assertSumInvariant(res, Math.round);
  });

  /**
   * The March stay's three nights, and NOT the June stay's two — those were
   * spent at sea, which is the precedence rule the account states and the
   * one the panel must not quietly reverse.
   */
  it("travelAccountHotelNights: the March stay only — the June one lost its nights to the cabin", () => {
    const res = answer("travelAccountHotelNights");
    expect(res.measure.value).toBe(3);
    expect(res.entries.map((e) => e.id)).toEqual([marchStayId]);
    expect(res.entries[0].contribution).toBe(3);
    // A stay's evidence is the STAY; the link goes to its lodging, which is
    // a different row (`shared/evidence.ts`, "Identity").
    expect(res.entries[0].href).toBe(`/lodging/${lodgingId}`);
    expect(res.entries[0].title.text).toBe("Hotel Nordlicht");
    assertSumInvariant(res, Math.round);
  });

  it("travelAccountAirNights: the red-eye, credited to the flight that flew it", () => {
    const res = answer("travelAccountAirNights");
    expect(res.measure.value).toBe(1);
    expect(res.entries.map((e) => e.title.text)).toEqual(["TA100"]);
    expect(res.entries[0].domain).toBe("flight");
    assertSumInvariant(res, Math.round);
  });

  /**
   * Both sides of the disagreement are listed, not just the winner, and each
   * contested night hands out ONE unit split between them — two claimants,
   * half each, so two nights make one contribution apiece.
   */
  it("travelAccountContestedNights: the cruise AND the stay that overlapped it", () => {
    const res = answer("travelAccountContestedNights");
    expect(res.measure.value).toBe(2);
    expect([...res.entries.map((e) => e.id)].sort()).toEqual([cruiseId, juneStayId].sort());
    for (const entry of res.entries) {
      expect(entry.contribution).toBe(1);
    }
    const stay = res.entries.find((e) => e.id === juneStayId)!;
    expect(stay.subtitle?.key).toBe("evidence.travelAccount.contestedWith.sea");
    const cruise = res.entries.find((e) => e.id === cruiseId)!;
    expect(cruise.subtitle?.key).toBe("evidence.travelAccount.contestedWith.hotel");
    assertSumInvariant(res, Math.round);
  });

  /**
   * The one measure with no row to name, ever: a home night is what is LEFT
   * once every stay, cruise and flight has been subtracted from the year.
   * The figure is still derived — an abstention would claim otherwise — and
   * it is carried in `unattributed` so the panel says why the list is empty.
   */
  it("travelAccountHomeNights: a real number with every night unattributed", () => {
    const res = answer("travelAccountHomeNights");
    // 2024 is a leap year: 366 days less 7 at sea, 3 in a hotel, 1 in the air.
    expect(res.measure.value).toBe(355);
    expect(res.entries).toEqual([]);
    expect(res.unattributed).toEqual([{ count: 355, reason: "notPerEntry" }]);
    assertSumInvariant(res, Math.round);
  });

  it("travelAccountTripsWithDatesCount: both trips, each contributing one", () => {
    const res = answer("travelAccountTripsWithDatesCount");
    expect(res.measure.value).toBe(2);
    expect(res.measure.unit).toBe("trips");
    expect([...res.entries.map((e) => e.id)].sort()).toEqual([coveredTripId, gappedTripId].sort());
    expect(res.entries.every((e) => e.domain === "trip")).toBe(true);
    assertSumInvariant(res, Math.round);
  });

  it("travelAccountFullyCoveredTripCount: the March trip, not the empty October one", () => {
    const res = answer("travelAccountFullyCoveredTripCount");
    expect(res.measure.value).toBe(1);
    expect(res.entries.map((e) => e.id)).toEqual([coveredTripId]);
    expect(res.entries[0].href).toBe(`/trips/${coveredTripId}`);
    assertSumInvariant(res, Math.round);
  });

  /**
   * Only the trip that actually left a gap is evidence. Listing the fully
   * covered one at contribution 0 would answer "which entries produced this
   * number" with a row that produced none of it.
   */
  it("travelAccountUncoveredDayCount: four days, all of them October's", () => {
    const res = answer("travelAccountUncoveredDayCount");
    expect(res.measure.value).toBe(4);
    expect(res.measure.unit).toBe("days");
    expect(res.entries.map((e) => e.id)).toEqual([gappedTripId]);
    expect(res.entries[0].contribution).toBe(4);
    assertSumInvariant(res, Math.round);
  });

  it("travelAccountJournalEntryCount: the two entries of the one trip that has any", () => {
    const res = answer("travelAccountJournalEntryCount");
    expect(res.measure.value).toBe(2);
    expect(res.entries.map((e) => e.id)).toEqual([coveredTripId]);
    expect(res.entries[0].contribution).toBe(2);
    assertSumInvariant(res, Math.round);
  });

  it("all nine measures equal the numbers /stats/travel-account renders", async () => {
    const account = await request(app)
      .get("/api/v1/stats/travel-account")
      .set("Cookie", userACookie);
    expect(account.status).toBe(200);
    const years = account.body.account.years as Array<{
      hotelNights: number;
      seaNights: number;
      airNights: number;
      homeNights: number;
    }>;
    const across = (field: keyof (typeof years)[number]): number =>
      years.reduce((total, year) => total + year[field], 0);
    const trips = account.body.trips;

    const pairs: Array<[(typeof KEYS)[number], number]> = [
      ["travelAccountHotelNights", across("hotelNights")],
      ["travelAccountSeaNights", across("seaNights")],
      ["travelAccountAirNights", across("airNights")],
      ["travelAccountHomeNights", across("homeNights")],
      ["travelAccountContestedNights", account.body.account.contestedNights],
      ["travelAccountFullyCoveredTripCount", trips.fullyCoveredTrips],
      ["travelAccountTripsWithDatesCount", trips.tripsWithDates],
      ["travelAccountUncoveredDayCount", trips.totalUncoveredDays],
      ["travelAccountJournalEntryCount", trips.journalEntries],
    ];
    for (const [key, rendered] of pairs) {
      // The key rides in the assertion so a failure names WHICH measure
      // diverged rather than printing two bare numbers.
      expect([key, answer(key).measure.value]).toEqual([key, rendered]);
    }
  });

  it("answers 400 for a year scope this section cannot show", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/travelAccountSeaNights")
      .query({ period: "year", year: 2024 })
      .set("Cookie", userACookie);
    expect(res.status).toBe(400);
  });

  it("never counts user A's nights into user B's own answer", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/travelAccountHotelNights")
      .set("Cookie", userBCookie);
    expect(res.status).toBe(200);
    expect(res.body.measure.value).toBe(2);
    expect(res.body.entries.map((e: { title: { text: string } }) => e.title.text)).toEqual([
      "Pension Anders",
    ]);
  });
});
