import { prisma } from "../../../db";
import { ingestTravTrackPoints } from "../ingest";
import {
  deleteTravTrackRange,
  registerPointsRemovedHandler,
  type PointsRemovedCause,
} from "../deleteRange";
import { makeFlight, makeTrip, makeUser, pt, wipeTravTrack } from "./fixtures";

/**
 * Delete is final (TravTrack plan T2, review focus 9): a range delete removes
 * points and their links, clips the reported gaps, leaves a tombstone, tells
 * the `onPointsRemoved` hook, and leaves flights and trips standing.
 */

const PREFIX = "travtrack-delete-";

describe("TravTrack range delete", () => {
  let userId: string;
  const causes: PointsRemovedCause[] = [];
  let unregister: () => void;

  const gapRow = (fromAt: string, toAt: string, reason = "recorderSilent") =>
    prisma.travTrackGap.create({
      data: { userId, deviceId: "phone-1", fromAt: new Date(fromAt), toAt: new Date(toAt), reason },
    });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    unregister = registerPointsRemovedHandler(async (_tx, uid, cause) => {
      if (uid === userId) causes.push(cause);
    });
  });

  beforeEach(async () => {
    causes.length = 0;
    await wipeTravTrack([userId]);
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    unregister();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("removes the span's points and their links, keeps flights and trips, and leaves a tombstone", async () => {
    const tripId = await makeTrip(userId);
    const flightId = await makeFlight(userId);
    const entries = [
      { kind: "trip", id: tripId },
      { kind: "flight", id: flightId },
    ];
    await ingestTravTrackPoints({
      userId,
      deviceId: "phone-1",
      uploadId: "u1",
      points: [
        pt("in", "2026-10-12T01:00:00Z", 1, 1, { entries }),
        pt("out", "2026-10-12T03:00:00Z", 1, 1, { entries }),
      ],
    });
    const from = new Date("2026-10-12T00:00:00Z");
    const to = new Date("2026-10-12T02:00:00Z");

    expect(await deleteTravTrackRange(userId, from, to)).toEqual({ deleted: 1, gapsClipped: 0 });

    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(1);
    expect(await prisma.travTrackPointLink.count({ where: { userId } })).toBe(2);
    expect(await prisma.trip.count({ where: { id: tripId } })).toBe(1);
    expect(await prisma.flight.count({ where: { id: flightId } })).toBe(1);
    expect(
      await prisma.travTrackDeletedRange.findMany({
        where: { userId },
        select: { fromAt: true, toAt: true },
      })
    ).toEqual([{ fromAt: from, toAt: to }]);
    // What went is named, collected before the delete (E5): the one point inside.
    const inside = Math.floor(Date.parse("2026-10-12T01:00:00Z") / 1000);
    expect(causes).toEqual([
      {
        kind: "range",
        from,
        to,
        spans: [[inside * 1000, inside * 1000]],
        days: ["2026-10-12"],
        keys: new Set([`${inside}|1|1`]),
      },
    ]);
  });

  it("deleting a range shortens a gap that overlaps its edge and splits one that spans it", async () => {
    await gapRow("2026-10-12T00:00:00Z", "2026-10-12T02:00:00Z", "permission"); // over the start
    await gapRow("2026-10-12T02:30:00Z", "2026-10-12T03:00:00Z", "zonesUnknown"); // inside
    await gapRow("2026-10-11T00:00:00Z", "2026-10-13T00:00:00Z"); // spans it
    await gapRow("2026-10-14T00:00:00Z", "2026-10-14T01:00:00Z"); // elsewhere

    const result = await deleteTravTrackRange(
      userId,
      new Date("2026-10-12T01:00:00Z"),
      new Date("2026-10-12T04:00:00Z")
    );
    expect(result).toEqual({ deleted: 0, gapsClipped: 3 });

    const rows = await prisma.travTrackGap.findMany({
      where: { userId },
      orderBy: [{ fromAt: "asc" }, { reason: "asc" }],
    });
    expect(rows.map((g) => [g.reason, g.fromAt.toISOString(), g.toAt.toISOString()])).toEqual([
      ["recorderSilent", "2026-10-11T00:00:00.000Z", "2026-10-12T01:00:00.000Z"],
      ["permission", "2026-10-12T00:00:00.000Z", "2026-10-12T01:00:00.000Z"],
      ["recorderSilent", "2026-10-12T04:00:00.000Z", "2026-10-13T00:00:00.000Z"],
      ["recorderSilent", "2026-10-14T00:00:00.000Z", "2026-10-14T01:00:00.000Z"],
    ]);
  });

  it("joins a caller's transaction when given one", async () => {
    await ingestTravTrackPoints({
      userId,
      deviceId: "phone-1",
      uploadId: "u-tx",
      points: [pt("in", "2026-10-12T01:00:00Z")],
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await deleteTravTrackRange(
          userId,
          new Date("2026-10-12T00:00:00Z"),
          new Date("2026-10-12T02:00:00Z"),
          tx
        );
        throw new Error("roll back");
      })
    ).rejects.toThrow("roll back");
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(1);
    expect(await prisma.travTrackDeletedRange.count({ where: { userId } })).toBe(0);
  });
});
