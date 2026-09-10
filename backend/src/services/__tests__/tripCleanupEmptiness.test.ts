import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { findMicroTripCandidates, dissolveMicroTrips } from "../tripCleanupService";

/**
 * "Tidy up" must only offer trips that really hold nothing.
 *
 * The emptiness rule named six relations and two text fields, all of them from
 * before the app had more than flights. A trip with a hotel stay, a place
 * visit, a linked Immich album or an AI summary counted as empty and was
 * offered as a candidate — and the dialog pre-selects everything it is offered,
 * so one confirmation removed curated non-flight trips (audit finding AUD-031).
 *
 * Each case gets its own trip so a single over-broad criterion cannot be hidden
 * by another one happening to catch the same row.
 */
const USERNAME = `trip-emptiness-${Date.now()}`;

describe("micro-trip candidates", () => {
  let userId: string;
  let lodgingId: string;
  let placeId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    lodgingId = (
      await prisma.lodging.create({ data: { userId, name: "Tidy Hotel", type: "hotel" } })
    ).id;
    placeId = (
      await prisma.place.create({ data: { userId, name: "Tidy Place", lat: 1, lon: 1 } })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
  });

  it("offers a trip that truly holds nothing", async () => {
    // The positive case, first: without it every assertion below could pass
    // because the scan returns nothing at all.
    const bare = await prisma.trip.create({ data: { userId, name: "Bare" } });
    const ids = (await findMicroTripCandidates(userId)).map((c) => c.id);
    expect(ids).toEqual([bare.id]);
  });

  const withContent: Array<[string, (tripId: string) => Promise<unknown>]> = [
    ["a hotel stay", (tripId) =>
      prisma.lodgingStay.create({ data: { userId, lodgingId, tripId, status: "completed" } })],
    ["a place visit", (tripId) =>
      prisma.placeVisit.create({ data: { userId, placeId, tripId } })],
    ["a linked album", (tripId) =>
      prisma.tripImmichAlbum.create({
        data: { tripId, immichAlbumId: `al-${tripId}`, albumName: "Album" },
      })],
    ["a summary", (tripId) =>
      prisma.trip.update({ where: { id: tripId }, data: { summary: "Written up" } })],
    ["a cover image", (tripId) =>
      prisma.trip.update({ where: { id: tripId }, data: { coverImageUrl: "/x.jpg" } })],
    ["tags", (tripId) => prisma.trip.update({ where: { id: tripId }, data: { tags: ["ski"] } })],
  ];

  it.each(withContent)("does not offer a trip that has %s", async (_label, add) => {
    const trip = await prisma.trip.create({ data: { userId, name: "Curated" } });
    await add(trip.id);

    const ids = (await findMicroTripCandidates(userId)).map((c) => c.id);
    expect(ids).not.toContain(trip.id);
  });

  it.each(withContent)("refuses to dissolve a trip that gained %s meanwhile", async (_label, add) => {
    const trip = await prisma.trip.create({ data: { userId, name: "Curated later" } });
    // Offered while still bare — this is the stale client list.
    expect((await findMicroTripCandidates(userId)).map((c) => c.id)).toContain(trip.id);

    await add(trip.id);
    const result = await dissolveMicroTrips(userId, [trip.id]);

    expect(result.dissolved).toBe(0);
    expect(await prisma.trip.findUnique({ where: { id: trip.id } })).not.toBeNull();
  });
});
