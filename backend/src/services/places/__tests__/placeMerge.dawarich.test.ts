import { prisma } from "../../../db";
import { mergePlaces } from "../placeMerge";

/**
 * A merge and a delete must leave no Dawarich finding pointing at a place or
 * trip that is gone, and a merge must not quietly downgrade a counted country
 * visit to transit (fix/ct142-places).
 */
const ALL_TARGET = {
  name: "target",
  localName: "target",
  category: "target",
  position: "target",
  address: "target",
  notes: "target",
} as const;

let userId: string;

const stay = (over: { placeId?: string | null; tripId?: string | null; fingerprint: string }) =>
  prisma.dawarichStay.create({
    data: {
      userId,
      status: "accepted",
      sourceStartAt: new Date("2026-10-10T03:00:00Z"),
      sourceEndAt: new Date("2026-10-10T04:00:00Z"),
      sourceLat: 37.57,
      sourceLon: 126.97,
      startAt: new Date("2026-10-10T03:00:00Z"),
      endAt: new Date("2026-10-10T04:00:00Z"),
      lat: 37.57,
      lon: 126.97,
      zone: "Asia/Seoul",
      pointCount: 4,
      evidence: { source: "dawarich" },
      ...over,
    },
  });
const place = (name: string, extra: Record<string, unknown> = {}) =>
  prisma.place.create({ data: { userId, name, lat: 37.57, lon: 126.97, ...extra } });

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `merge-dawarich-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.dawarichStay.deleteMany({ where: { userId } });
  await prisma.placeVisit.deleteMany({ where: { userId } });
  await prisma.place.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
});

describe("Dawarich findings and the places they name", () => {
  it("follow a merged place to the place that stays", async () => {
    const target = await place("Gyeongbokgung");
    const source = await place("Gyeongbokgung Palace");
    const row = await stay({ placeId: source.id, fingerprint: "merge" });
    const counts = await mergePlaces(userId, target.id, {
      sourceId: source.id,
      fields: ALL_TARGET,
    });
    expect(counts.dawarichStays).toBe(1);
    expect((await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } })).placeId).toBe(
      target.id
    );
  });

  it("let go of a deleted place or trip instead of pointing at nothing", async () => {
    const gone = await place("Gone");
    const trip = await prisma.trip.create({ data: { userId, name: "Gone trip" } });
    const row = await stay({ placeId: gone.id, tripId: trip.id, fingerprint: "delete" });
    await prisma.place.delete({ where: { id: gone.id } });
    await prisma.trip.delete({ where: { id: trip.id } });
    const after = await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.placeId).toBeNull();
    expect(after.tripId).toBeNull();
  });
});

describe("merging the country-visit kind", () => {
  it("keeps a counted visit when the duplicate had one and the kept place said transit", async () => {
    const target = await place("Airport hotel", { countryVisitKind: "transit" });
    const source = await place("Airport hotel (stay)", { countryVisitKind: "visit" });
    await mergePlaces(userId, target.id, { sourceId: source.id, fields: ALL_TARGET });
    expect(
      (await prisma.place.findUniqueOrThrow({ where: { id: target.id } })).countryVisitKind
    ).toBe("visit");
  });

  it("stays transit when both sides were transit", async () => {
    const target = await place("Lounge", { countryVisitKind: "transit" });
    const source = await place("Lounge B", { countryVisitKind: "transit" });
    await mergePlaces(userId, target.id, { sourceId: source.id, fields: ALL_TARGET });
    expect(
      (await prisma.place.findUniqueOrThrow({ where: { id: target.id } })).countryVisitKind
    ).toBe("transit");
  });
});
