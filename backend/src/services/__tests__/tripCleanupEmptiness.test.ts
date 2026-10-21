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
    placeId = (await prisma.place.create({ data: { userId, name: "Tidy Place", lat: 1, lon: 1 } }))
      .id;
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
    [
      "a hotel stay",
      (tripId) =>
        prisma.lodgingStay.create({ data: { userId, lodgingId, tripId, status: "completed" } }),
    ],
    // forgejo#288 sweep: all three are SetNull on the trip, so a dissolve would
    // have silently unfiled them from a trip that looked empty.
    [
      "a train ride",
      (tripId) =>
        prisma.railJourney.create({
          data: {
            userId,
            tripId,
            depStationName: "A",
            depLat: 1,
            depLon: 1,
            arrStationName: "B",
            arrLat: 2,
            arrLon: 2,
            departureTime: new Date("2026-06-01T08:00:00Z"),
          },
        }),
    ],
    [
      "a bus ride",
      (tripId) =>
        prisma.busJourney.create({
          data: {
            userId,
            tripId,
            depStationName: "A",
            depLat: 1,
            depLon: 1,
            arrStationName: "B",
            arrLat: 2,
            arrLon: 2,
            departureTime: new Date("2026-06-01T08:00:00Z"),
          },
        }),
    ],
    [
      "a rental car",
      (tripId) =>
        prisma.rentalBooking.create({
          data: {
            userId,
            tripId,
            provider: "Sixt",
            pickupStationName: "X",
            pickupLat: 1,
            pickupLon: 1,
            pickupTimezone: "UTC",
            returnStationName: "X",
            returnLat: 1,
            returnLon: 1,
            returnTimezone: "UTC",
            pickupTime: new Date("2026-06-01T09:00:00Z"),
            returnTime: new Date("2026-06-02T09:00:00Z"),
          },
        }),
    ],
    ["a place visit", (tripId) => prisma.placeVisit.create({ data: { userId, placeId, tripId } })],
    [
      // forgejo#140: a vignette booked on the trip is money a dissolve would delete.
      "a trip-wide expense",
      (tripId) =>
        prisma.tripExpense.create({
          data: { userId, tripId, kind: "toll", amount: 9.6, currency: "CHF" },
        }),
    ],
    [
      "a linked album",
      (tripId) =>
        prisma.tripImmichAlbum.create({
          data: { tripId, immichAlbumId: `al-${tripId}`, albumName: "Album" },
        }),
    ],
    [
      "a kept document",
      (tripId) =>
        prisma.document.create({
          data: {
            userId,
            tripId,
            storedName: `tidy-${tripId}.pdf`,
            mimetype: "application/pdf",
            sizeBytes: 1,
            sha256: "0".repeat(64),
            format: "pdf",
            linkedAt: new Date(),
          },
        }),
    ],
    [
      // forgejo#316: a recording CASCADES with its trip — every point gone.
      "a recording",
      (tripId) =>
        prisma.tripRecordingBatch.create({
          data: {
            userId,
            tripId,
            uploadId: `tidy-rec-${tripId}`,
            startedAt: new Date("2026-06-01T08:00:00Z"),
            endedAt: new Date("2026-06-01T08:05:00Z"),
            points: [[Date.parse("2026-06-01T08:00:00Z"), 1, 1, null]],
            pointCount: 1,
          },
        }),
    ],
    [
      "a summary",
      (tripId) => prisma.trip.update({ where: { id: tripId }, data: { summary: "Written up" } }),
    ],
    [
      "a cover image",
      (tripId) => prisma.trip.update({ where: { id: tripId }, data: { coverImageUrl: "/x.jpg" } }),
    ],
    ["tags", (tripId) => prisma.trip.update({ where: { id: tripId }, data: { tags: ["ski"] } })],
  ];

  it.each(withContent)("does not offer a trip that has %s", async (_label, add) => {
    const trip = await prisma.trip.create({ data: { userId, name: "Curated" } });
    await add(trip.id);

    const ids = (await findMicroTripCandidates(userId)).map((c) => c.id);
    expect(ids).not.toContain(trip.id);
  });

  it.each(withContent)(
    "refuses to dissolve a trip that gained %s meanwhile",
    async (_label, add) => {
      const trip = await prisma.trip.create({ data: { userId, name: "Curated later" } });
      // Offered while still bare — this is the stale client list.
      expect((await findMicroTripCandidates(userId)).map((c) => c.id)).toContain(trip.id);

      await add(trip.id);
      const result = await dissolveMicroTrips(userId, [trip.id]);

      expect(result.dissolved).toBe(0);
      expect(await prisma.trip.findUnique({ where: { id: trip.id } })).not.toBeNull();
    }
  );
});
