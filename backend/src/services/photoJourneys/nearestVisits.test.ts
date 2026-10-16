import { prisma } from "../../db";
import { nearestVisits, type NearestVisitInput } from "./nearestVisits";

/**
 * The nearest logged visit beside a `visit` finding (fix/ct142-places): a
 * visit's day is read on its own clock, and only the visits of each finding's
 * own days are loaded — not every visit between the oldest and newest finding.
 */
const SEOUL = { lat: 37.5796, lon: 126.977 };
let userId: string;
let placeId: string;

const visitAt = (instant: string, zone: string | null = "Asia/Seoul") =>
  prisma.placeVisit.create({
    data: {
      userId,
      placeId,
      visitedAt: new Date(instant),
      visitedAtUtc: zone ? new Date(instant) : null,
      visitedZone: zone,
      visitedPrecision: zone ? "minute" : null,
    },
  });
const finding = (id: string, day: string): NearestVisitInput => ({
  id,
  kind: "visit",
  tripId: null,
  ...SEOUL,
  startDay: day,
  endDay: day,
});

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `pj-nearest-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  placeId = (await prisma.place.create({ data: { userId, name: "Gyeongbokgung", ...SEOUL } })).id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.placeVisit.deleteMany({ where: { userId } });
});

describe("nearest visit to a photo finding", () => {
  it("reads the visit's day at the place, not the UTC date of the legacy column", async () => {
    // 05:00 in Seoul on 1 May — 30 April in UTC.
    await visitAt("2026-04-30T20:00:00Z");
    const result = await nearestVisits(userId, [finding("f", "2026-05-01")]);
    expect(result.get("f")).toMatchObject({ placeId, sameDay: true, withinReach: true });
  });

  it("loads only the visits of each finding's own days", async () => {
    await visitAt("2026-01-10T03:00:00Z");
    await visitAt("2026-06-10T03:00:00Z");
    await visitAt("2026-12-10T03:00:00Z");
    const spy = jest.spyOn(prisma.placeVisit, "findMany");
    try {
      const result = await nearestVisits(userId, [
        finding("jan", "2026-01-10"),
        finding("dec", "2026-12-10"),
      ]);
      expect(result.get("jan")?.sameDay).toBe(true);
      expect(result.get("dec")?.sameDay).toBe(true);
      const loaded = (
        await Promise.all(spy.mock.results.map((r) => r.value as Promise<unknown[]>))
      ).flat();
      expect(loaded).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });
});
