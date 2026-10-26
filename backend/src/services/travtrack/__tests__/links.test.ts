import { prisma } from "../../../db";
import { mergeTrips } from "../../tripCleanupService";
import { ingestTravTrackPoints } from "../ingest";
import { cleanupOrphanLinks, linkedPointIds } from "../links";
import { makeFlight, makeTrip, makeUser, pt, wipeTravTrack } from "./fixtures";

/**
 * Links between points and entries (TravTrack plan T2). A link has no foreign
 * key to its entry; it is harmless once the entry is gone because every read
 * joins the entry and its owner, and a nightly sweep removes it. The point
 * always stays.
 */

const PREFIX = "travtrack-links-";

describe("TravTrack links", () => {
  let userId: string;
  let otherId: string;

  const upload = (uploadId: string, ref: string, t: string, entries: object[]) =>
    ingestTravTrackPoints({
      userId,
      deviceId: "phone-1",
      uploadId,
      points: [pt(ref, t, 1, 1, { entries })],
    });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
  });

  beforeEach(async () => {
    await wipeTravTrack([userId, otherId]);
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("a link to a deleted flight is never read and the sweep removes it, the point stays", async () => {
    const flightId = await makeFlight(userId);
    await upload("u1", "p", "2026-10-12T01:00:00Z", [{ kind: "flight", id: flightId }]);
    expect(await linkedPointIds(userId, "flight", flightId)).toHaveLength(1);

    await prisma.flight.delete({ where: { id: flightId } });
    expect(await linkedPointIds(userId, "flight", flightId)).toEqual([]);
    expect(await prisma.travTrackPointLink.count({ where: { userId } })).toBe(1);

    expect(await cleanupOrphanLinks()).toBeGreaterThanOrEqual(1);
    expect(await prisma.travTrackPointLink.count({ where: { userId } })).toBe(0);
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(1);
  });

  it("reads only the owner's links", async () => {
    const tripId = await makeTrip(userId);
    await upload("u1", "p", "2026-10-12T01:00:00Z", [{ kind: "trip", id: tripId }]);
    expect(await linkedPointIds(otherId, "trip", tripId)).toEqual([]);
    expect(await linkedPointIds(userId, "trip", tripId)).toHaveLength(1);
  });

  it("the sweep keeps links whose entry exists", async () => {
    const tripId = await makeTrip(userId);
    await upload("u1", "p", "2026-10-12T01:00:00Z", [{ kind: "trip", id: tripId }]);
    await cleanupOrphanLinks();
    expect(await prisma.travTrackPointLink.count({ where: { userId } })).toBe(1);
  });

  it("merging trips moves the links and drops the ones that would collide", async () => {
    const target = await makeTrip(userId, "Ziel");
    const source = await makeTrip(userId, "Quelle");
    const both = [
      { kind: "trip", id: target },
      { kind: "trip", id: source },
    ];
    await upload("u1", "shared", "2026-10-12T01:00:00Z", both);
    await upload("u2", "only-source", "2026-10-12T02:00:00Z", [{ kind: "trip", id: source }]);

    await mergeTrips(userId, { tripIds: [target, source], targetId: target });

    const links = await prisma.travTrackPointLink.findMany({
      where: { userId },
      select: { entryKind: true, entryId: true, point: { select: { originRef: true } } },
      orderBy: { createdAt: "asc" },
    });
    expect(links.map((l) => [l.point.originRef, l.entryKind, l.entryId]).sort()).toEqual(
      [
        ["only-source", "trip", target],
        ["shared", "trip", target],
      ].sort()
    );
    expect(await linkedPointIds(userId, "trip", target)).toHaveLength(2);
  });
});
