import { prisma } from "../../../db";
import { ingestPoints, ingestTravTrackPoints } from "../ingest";
import { makeUser, pt, wipeTravTrack } from "./fixtures";

/**
 * One ingest for every source (TravTrack plan E8): the origin names where a
 * point came from, a source without a receipt id stays idempotent by the
 * origin's own ids and by the position key, the work can run inside a
 * caller's transaction, and a fence decides under the lock whether it runs.
 */

const PREFIX = "travtrack-ingest-origin-";

describe("TravTrack ingest — origins", () => {
  let userId: string;

  const gpx = (points: Record<string, unknown>[], extra: object = {}) =>
    ingestPoints({
      userId,
      origin: "gpx:imp-1",
      deviceId: "file:imp-1",
      uploadId: null,
      points,
      ...extra,
    });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await wipeTravTrack([userId]);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("the Companion's upload keeps its origin and its receipt", async () => {
    const { result } = await ingestTravTrackPoints({
      userId,
      deviceId: "phone-1",
      uploadId: "u1",
      points: [pt("a", "2026-10-12T01:00:00Z")],
    });
    expect(result).toMatchObject({ uploadId: "u1", stored: 1 });
    const row = await prisma.travTrackPoint.findFirstOrThrow({ where: { userId } });
    expect(row).toMatchObject({ origin: "companion:phone-1", deviceId: "phone-1" });
    expect(await prisma.travTrackUpload.count({ where: { userId } })).toBe(1);
  });

  it("an upload without uploadId stays idempotent by origin ref and position", async () => {
    const first = await gpx([pt("0:0", "2026-10-12T01:00:00Z"), pt("0:1", "2026-10-12T01:01:00Z")]);
    expect(first.result).toMatchObject({ uploadId: null, stored: 2, duplicate: 0 });
    // The same file again: the same refs.
    const again = await gpx([pt("0:0", "2026-10-12T01:00:00Z"), pt("0:1", "2026-10-12T01:01:00Z")]);
    expect(again).toMatchObject({ replayed: false, result: { stored: 0, duplicate: 2 } });
    // Another origin with the same second and coordinates: the position key holds.
    const other = await ingestPoints({
      userId,
      origin: "gpx:imp-2",
      deviceId: "file:imp-2",
      uploadId: null,
      points: [pt("0:0", "2026-10-12T01:00:00.400Z")],
    });
    expect(other.result).toMatchObject({ stored: 0, duplicate: 1 });
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(2);
    expect(await prisma.travTrackUpload.count({ where: { userId } })).toBe(0);
    const row = await prisma.travTrackPoint.findFirstOrThrow({ where: { userId } });
    expect(row).toMatchObject({ origin: "gpx:imp-1", deviceId: "file:imp-1" });
  });

  it("inside an outer transaction nothing is visible until it commits", async () => {
    let seenInside = -1;
    let seenOutside = -1;
    await prisma.$transaction(async (tx) => {
      await gpx([pt("0:0", "2026-10-12T01:00:00Z")], { outer: tx });
      seenInside = await tx.travTrackPoint.count({ where: { userId } });
      seenOutside = await prisma.travTrackPoint.count({ where: { userId } });
    });
    expect(seenInside).toBe(1);
    expect(seenOutside).toBe(0);
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(1);
  });

  it("an outer transaction that rolls back takes the points with it", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await gpx([pt("0:0", "2026-10-12T01:00:00Z")], { outer: tx });
        throw new Error("caller failed");
      })
    ).rejects.toThrow("caller failed");
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(0);
  });

  it("a fence that throws stores nothing; one that passes lets the batch through", async () => {
    await expect(
      gpx([pt("0:0", "2026-10-12T01:00:00Z")], {
        fence: async () => {
          throw new Error("import cancelled");
        },
      })
    ).rejects.toThrow("import cancelled");
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(0);
    const ran: string[] = [];
    await gpx([pt("0:0", "2026-10-12T01:00:00Z")], {
      fence: async () => {
        ran.push("fence");
      },
    });
    expect(ran).toEqual(["fence"]);
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(1);
  });

  it("a point of any source inside a privacy zone is dropped, before the deleted range", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Home", lat: 37.5665, lon: 126.978, radiusM: 200 },
    });
    await prisma.travTrackDeletedRange.create({
      data: {
        userId,
        fromAt: new Date("2026-10-12T00:00:00Z"),
        toAt: new Date("2026-10-13T00:00:00Z"),
      },
    });
    const { result } = await gpx([
      pt("0:0", "2026-10-12T01:00:00Z"),
      pt("0:1", "2026-10-12T01:01:00Z", 37.6, 127.1),
      pt("0:2", "2026-10-14T01:00:00Z", 37.6, 127.1),
    ]);
    expect(result.outcomes.map((o) => (o.outcome === "dropped" ? o.reason : o.outcome))).toEqual([
      "privacy_zone",
      "deleted_range",
      "stored",
    ]);
  });
});
