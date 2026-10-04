import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { toDbDate } from "../../../shared/time/localDate";
import { soleTripForDay, tripSpan, visitLocalDay, type TripSpanColumns } from "../visitTrip";
import { assignVisitTrips } from "../visitTripBackfill";

const span = (id: string, first: string | null, last: string | null): TripSpanColumns => ({
  id,
  startDay: first ? toDbDate(first) : null,
  endDay: last ? toDbDate(last) : null,
  startDate: null,
  endDate: null,
  startZone: null,
  endZone: null,
});

describe("the trip a visit's day belongs to (forgejo#199)", () => {
  it("reads the visit's day on its own clock", () => {
    const at = new Date("2026-10-02T16:30:00Z");
    expect(
      visitLocalDay({ visitedAtUtc: at, visitedZone: "Asia/Seoul", visitedPrecision: "minute" })
    ).toBe("2026-10-03");
    expect(
      visitLocalDay({ visitedAtUtc: at, visitedZone: "Europe/Berlin", visitedPrecision: "day" })
    ).toBe("2026-10-02");
  });

  it("knows no day for a visit without a zone, or dated only to the month", () => {
    const at = new Date("2026-10-02T16:30:00Z");
    expect(visitLocalDay({ visitedAtUtc: at, visitedZone: null, visitedPrecision: "day" })).toBe(
      null
    );
    expect(
      visitLocalDay({ visitedAtUtc: at, visitedZone: "Asia/Seoul", visitedPrecision: "month" })
    ).toBe(null);
    expect(
      visitLocalDay({ visitedAtUtc: at, visitedZone: "Asia/Seoul", visitedPrecision: "unknown" })
    ).toBe(null);
    expect(
      visitLocalDay({ visitedAtUtc: null, visitedZone: "Asia/Seoul", visitedPrecision: "day" })
    ).toBe(null);
  });

  it("treats a trip with one known end as that one day, and one with none as no span", () => {
    expect(tripSpan(span("a", "2026-10-03", null))).toEqual({
      first: "2026-10-03",
      last: "2026-10-03",
    });
    expect(tripSpan(span("b", null, null))).toBeNull();
  });

  it("picks the one trip, and none when several hold the day", () => {
    const korea = span("korea", "2026-10-03", "2026-10-19");
    const weekend = span("weekend", "2026-10-03", "2026-10-05");
    expect(soleTripForDay("2026-10-10", [korea, weekend])).toBe("korea");
    expect(soleTripForDay("2026-10-04", [korea, weekend])).toBeNull();
    expect(soleTripForDay("2026-11-01", [korea, weekend])).toBeNull();
  });
});

describe("assignVisitTrips — the review pass over stored visits", () => {
  const USER = "visittripbackfill";
  let userId: string;
  let placeId: string;

  const cleanup = async () => {
    await prisma.placeVisit.deleteMany({ where: { user: { username: USER } } });
    await prisma.place.deleteMany({ where: { user: { username: USER } } });
    await prisma.trip.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    userId = (
      await prisma.user.create({
        data: { username: USER, passwordHash: await hashPassword("password123") },
      })
    ).id;
    placeId = (
      await prisma.place.create({
        data: { userId, name: "반포대교", lat: 37.5126, lon: 126.9958 },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const visitOn = (utc: string, precision = "day") =>
    prisma.placeVisit.create({
      data: {
        userId,
        placeId,
        visitedAt: new Date(utc),
        visitedAtUtc: new Date(utc),
        visitedZone: "Asia/Seoul",
        visitedPrecision: precision,
      },
    });

  it("proposes on a dry run, writes nothing, and writes the proposals on apply", async () => {
    const korea = await prisma.trip.create({
      data: {
        userId,
        name: "Korea",
        startDay: toDbDate("2026-10-03"),
        endDay: toDbDate("2026-10-19"),
      },
    });
    // 2026-10-04 at the place (day precision: midnight in Seoul).
    const inside = await visitOn("2026-10-03T15:00:00Z");
    const outside = await visitOn("2026-05-01T03:00:00Z");
    const undated = await visitOn("2026-10-03T15:00:00Z", "month");

    const dry = await assignVisitTrips({ apply: false, userId });
    expect(dry).toMatchObject({ scanned: 3, undated: 1, noTrip: 1, severalTrips: 0 });
    expect(dry.proposals).toEqual([
      expect.objectContaining({
        visitId: inside.id,
        placeName: "반포대교",
        day: "2026-10-04",
        tripId: korea.id,
        tripName: "Korea",
      }),
    ]);
    expect((await prisma.placeVisit.findUniqueOrThrow({ where: { id: inside.id } })).tripId).toBe(
      null
    );

    await assignVisitTrips({ apply: true, userId });
    const tripOf = async (id: string) =>
      (await prisma.placeVisit.findUniqueOrThrow({ where: { id } })).tripId;
    expect(await tripOf(inside.id)).toBe(korea.id);
    expect(await tripOf(outside.id)).toBeNull();
    expect(await tripOf(undated.id)).toBeNull();

    // Idempotent: the filed visit is no longer a candidate.
    expect((await assignVisitTrips({ apply: true, userId })).proposals).toEqual([]);
  });
});
