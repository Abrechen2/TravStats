import { prisma } from "../../db";
import { acceptVisitFinding } from "./acceptVisit";

jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));

/**
 * Accepting a `visit` finding claims it first (fix/ct142-places): two accepts
 * racing each other made two places and two visits, and a finding the user had
 * DISMISSED could still be accepted through the PATCH route.
 */
let userId: string;
let tripId: string;

const finding = (status = "pending") =>
  prisma.photoJourney.create({
    data: {
      userId,
      status,
      kind: "visit",
      tripId,
      startDate: new Date("2026-05-01T05:10:00Z"),
      endDate: new Date("2026-05-01T05:30:00Z"),
      photoCount: 5,
      locatedCount: 5,
      lat: 37.5796,
      lon: 126.977,
      countryCode: "KR",
      countryName: "South Korea",
      city: "Seoul",
      previewAssetIds: [],
      fingerprint: `claim-${Math.random()}`,
      suggestedName: "Gyeongbokgung",
      suggestedRef: `osm:way/${Math.floor(Math.random() * 1e9)}`,
      suggestedCategory: "landmark",
    },
  });

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `pj-claim-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  tripId = (
    await prisma.trip.create({
      data: {
        userId,
        name: "Korea",
        startDate: new Date("2026-04-28T00:00:00Z"),
        endDate: new Date("2026-05-06T00:00:00Z"),
      },
    })
  ).id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.photoJourney.deleteMany({ where: { userId } });
  await prisma.placeVisit.deleteMany({ where: { userId } });
  await prisma.place.deleteMany({ where: { userId } });
});

describe("accepting a visit finding", () => {
  it("records one visit when two accepts race", async () => {
    // An own place takes the visit, so no unique place reference can stop the
    // second accept — only the claim can.
    const place = await prisma.place.create({
      data: { userId, name: "Gyeongbokgung", lat: 37.5796, lon: 126.977 },
    });
    const row = await finding();
    await prisma.photoJourney.update({ where: { id: row.id }, data: { placeId: place.id } });
    const outcomes = await Promise.allSettled([
      acceptVisitFinding(userId, row.id, {}),
      acceptVisitFinding(userId, row.id, {}),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.place.count({ where: { userId } })).toBe(1);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(1);
  });

  it("refuses a dismissed finding and writes nothing", async () => {
    const row = await finding("dismissed");
    await expect(acceptVisitFinding(userId, row.id, {})).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(await prisma.place.count({ where: { userId } })).toBe(0);
    expect(await prisma.placeVisit.count({ where: { userId } })).toBe(0);
    expect((await prisma.photoJourney.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "dismissed"
    );
  });

  it("still answers a retry of an accepted finding with the visit it made", async () => {
    const row = await finding();
    const first = await acceptVisitFinding(userId, row.id, {});
    const again = await acceptVisitFinding(userId, row.id, {});
    expect(again.placeVisitId).toBe(first.placeVisitId);
    expect(again.visitCreated).toBe(false);
  });
});
