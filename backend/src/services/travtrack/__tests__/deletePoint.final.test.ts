import { prisma } from "../../../db";
import { holdsTravTrackData } from "../availability";
import { deleteTravTrackPoint } from "../deletePoint";
import { deletedPointDigest } from "../deletedPoints";
import { ingestTravTrackPoints } from "../ingest";
import { deleteTravTrackImport, runGpxImport } from "../imports/fileImport";
import { settleAllJobs } from "../../jobs/jobRegistry";
import { makeUser, pt, wipeTravTrack } from "./fixtures";
import { gpxFile, minuteFixes } from "./gpxFixtures";

/**
 * A single-point delete is final (TravTrack plan T5.3): the point leaves a
 * tombstone of its identity — the ingest's cross-source key (second, lon,
 * lat) — so the same GPX file imported again, or the phone sending the fix
 * late, cannot bring it back. Another fix of the same second at another
 * position is not touched, and the tombstone keeps no coordinates.
 */

const PREFIX = "travtrack-point-final-";
const FIXES = minuteFixes("2026-10-12T01:00:00Z", 3);

describe("TravTrack — a deleted point stays deleted", () => {
  let userId: string;

  async function importFile() {
    const row = await prisma.travTrackImport.create({
      data: { userId, kind: "gpx", fileName: "walk.gpx", status: "running" },
    });
    const outcome = await runGpxImport(row.id, userId, { buffer: gpxFile([FIXES]) });
    return { importId: row.id, report: outcome.report };
  }

  const pointAt = (iso: string, lat: number, lon: number) =>
    prisma.travTrackPoint.findFirst({ where: { userId, t: new Date(iso), lat, lon } });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await settleAllJobs();
    await wipeTravTrack([userId]);
    await prisma.travTrackImport.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await settleAllJobs();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("re-importing the same GPX leaves the deleted point gone; the other fix of its second stays", async () => {
    const first = await importFile();
    expect(first.report).toMatchObject({ stored: 3 });
    // Another device's fix at the very second of the point about to go, elsewhere.
    const other = { lat: FIXES[1].lat + 0.01, lon: FIXES[1].lon };
    await ingestTravTrackPoints({
      userId,
      deviceId: "phone-1",
      uploadId: "u-1",
      points: [pt("o-1", FIXES[1].t, other.lat, other.lon)],
    });
    const target = await pointAt(FIXES[1].t, FIXES[1].lat, FIXES[1].lon);
    expect(target).not.toBeNull();

    await deleteTravTrackPoint(userId, target!.id);

    // The import's own points go with the import; the file comes back whole but one.
    await deleteTravTrackImport(userId, first.importId);
    const again = await importFile();
    expect(again.report).toMatchObject({ stored: 2, dropped: { deleted_range: 1 } });
    expect(await pointAt(FIXES[1].t, FIXES[1].lat, FIXES[1].lon)).toBeNull();
    expect(await pointAt(FIXES[1].t, other.lat, other.lon)).not.toBeNull();
    // No span is remembered: the second itself stays open to other positions.
    expect(await prisma.travTrackDeletedRange.count({ where: { userId } })).toBe(0);
  });

  it("the phone sending the deleted fix late is refused; a fix of the same second elsewhere is stored", async () => {
    const t = FIXES[0].t;
    await ingestTravTrackPoints({
      userId,
      deviceId: "phone-1",
      uploadId: "u-1",
      points: [pt("a", t, FIXES[0].lat, FIXES[0].lon)],
    });
    const stored = await prisma.travTrackPoint.findFirstOrThrow({ where: { userId } });
    await deleteTravTrackPoint(userId, stored.id);

    const { result } = await ingestTravTrackPoints({
      userId,
      deviceId: "phone-2",
      uploadId: "u-2",
      points: [
        pt("b", t, FIXES[0].lat, FIXES[0].lon),
        pt("c", t, FIXES[0].lat + 0.002, FIXES[0].lon),
      ],
    });

    expect(result.outcomes.map((o) => o.outcome)).toEqual(["dropped", "stored"]);
    expect(result.outcomes[0]).toMatchObject({ reason: "deleted_range" });
  });

  it("keeps a digest and the second only — never the position — and counts as data held", async () => {
    const t = FIXES[2].t;
    await ingestTravTrackPoints({
      userId,
      deviceId: "phone-1",
      uploadId: "u-1",
      points: [pt("a", t, FIXES[2].lat, FIXES[2].lon)],
    });
    const stored = await prisma.travTrackPoint.findFirstOrThrow({ where: { userId } });
    await deleteTravTrackPoint(userId, stored.id);

    const rows = await prisma.travTrackDeletedPoint.findMany({ where: { userId } });
    expect(rows).toEqual([
      expect.objectContaining({
        tS: Math.floor(Date.parse(t) / 1000),
        digest: deletedPointDigest(userId, stored),
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain(String(FIXES[2].lon));
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(0);
    expect(await holdsTravTrackData(userId)).toBe(true);
  });
});
