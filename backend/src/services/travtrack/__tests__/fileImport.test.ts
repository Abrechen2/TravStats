import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { ingestTravTrackPoints } from "../ingest";
import { deleteTravTrackImport, runGpxImport, startGpxImport } from "../imports/fileImport";
import { displayFileName, mapGpx, readGpxFile } from "../imports/mapGpx";
import { settleAllJobs } from "../../jobs/jobRegistry";
import { makeUser, pt, wipeTravTrack } from "./fixtures";
import { BILLION_LAUGHS, gpxFile, minuteFixes, XXE } from "./gpxFixtures";

/**
 * GPX files into TravTrack (TravTrack plan E8): a file goes through the same
 * ingest as the Companion — zones dropped, deleted spans refused, a fix the
 * phone already sent is a duplicate — and deleting the import removes only
 * the points it brought, leaving no tombstone. A file the server cannot use
 * says why.
 */

const PREFIX = "travtrack-gpx-";

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    return err instanceof AppError ? err.code : String(err);
  }
};

describe("TravTrack — GPX import", () => {
  let userId: string;

  /** A running import row as `startGpxImport` writes it, then its work run in-line. */
  async function importFile(
    buffer: Buffer,
    opts: Parameters<typeof runGpxImport>[3] = {}
  ): Promise<{ importId: string; outcome: Awaited<ReturnType<typeof runGpxImport>> }> {
    const row = await prisma.travTrackImport.create({
      data: { userId, kind: "gpx", fileName: "walk.gpx", status: "running" },
    });
    const outcome = await runGpxImport(row.id, userId, { buffer }, opts);
    return { importId: row.id, outcome };
  }

  const statusOf = async (id: string) =>
    (await prisma.travTrackImport.findUniqueOrThrow({ where: { id } })).status;

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

  describe("reading the file", () => {
    it("maps every fix with a time, names it by segment and index, and counts the rest", () => {
      const track = readGpxFile(
        gpxFile([
          [
            { t: "2026-10-12T01:00:00Z", lat: 37.5, lon: 127.0, ele: 42 },
            { lat: 37.51, lon: 127.01 },
          ],
          [
            { t: "2026-10-12T02:00:00Z", lat: 37.52, lon: 127.02, ele: 99_999 },
            { t: "2026-10-12T02:01:00Z", lat: 37.53, lon: 127.03 },
          ],
        ])
      );
      const mapped = mapGpx(track);
      expect(mapped.read).toBe(4);
      expect(mapped.withoutTime).toBe(1);
      expect(mapped.points).toEqual([
        {
          id: "0:0",
          t: "2026-10-12T01:00:00.000Z",
          lat: 37.5,
          lon: 127.0,
          altitude: 42,
          purpose: "everyday",
        },
        // An elevation no receiver reports is unknown, not a reason to lose the fix.
        {
          id: "1:0",
          t: "2026-10-12T02:00:00.000Z",
          lat: 37.52,
          lon: 127.02,
          altitude: null,
          purpose: "everyday",
        },
        {
          id: "1:1",
          t: "2026-10-12T02:01:00.000Z",
          lat: 37.53,
          lon: 127.03,
          altitude: null,
          purpose: "everyday",
        },
      ]);
      expect(mapped.fromMs).toBe(Date.parse("2026-10-12T01:00:00Z"));
      expect(mapped.untilMs).toBe(Date.parse("2026-10-12T02:01:00Z"));
    });

    it("refuses a document type declaration: no entity is ever expanded or fetched", () => {
      for (const file of [BILLION_LAUGHS, XXE]) {
        expect(() => readGpxFile(file)).toThrow(
          expect.objectContaining({ code: "TRAVTRACK_IMPORT_UNREADABLE" })
        );
      }
    });

    it("reads a file that starts with a byte-order mark", () => {
      const file = Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        gpxFile([minuteFixes("2026-10-12T01:00:00Z", 2)]),
      ]);
      expect(mapGpx(readGpxFile(file)).points).toHaveLength(2);
    });

    it("refuses what is not GPX as unreadable", () => {
      for (const file of [
        Buffer.from("not xml at all"),
        Buffer.from("<gpx><trk><trkseg><trkpt lat='1' lon='1'></trkseg></gpx>"),
        Buffer.from('<?xml version="1.0"?><kml></kml>'),
        Buffer.alloc(0),
      ]) {
        expect(() => readGpxFile(file)).toThrow(
          expect.objectContaining({ code: "TRAVTRACK_IMPORT_UNREADABLE" })
        );
      }
    });

    it("a file name is a label: no path, no control characters, at most 200 characters", () => {
      expect(displayFileName("../../etc/passwd")).toBe("passwd");
      expect(displayFileName("C:\\Users\\me\\walk.gpx")).toBe("walk.gpx");
      expect(displayFileName("a\u0000b\nc.gpx")).toBe("abc.gpx");
      expect(displayFileName("")).toBe("import.gpx");
      expect(displayFileName(`${"x".repeat(300)}.gpx`)).toHaveLength(200);
    });
  });

  describe("storing", () => {
    it("stores the file's fixes under its own origin and reports them", async () => {
      const { importId, outcome } = await importFile(
        gpxFile([minuteFixes("2026-10-12T01:00:00Z", 3)])
      );
      expect(outcome.status).toBe("succeeded");
      const row = await prisma.travTrackImport.findUniqueOrThrow({ where: { id: importId } });
      expect(row.status).toBe("succeeded");
      expect(row.report).toEqual({
        read: 3,
        stored: 3,
        duplicate: 0,
        dropped: { privacy_zone: 0, deleted_range: 0, invalid: 0, null_island: 0 },
        withoutTime: 0,
      });
      expect(row.fromAt?.toISOString()).toBe("2026-10-12T01:00:00.000Z");
      expect(row.toAt?.toISOString()).toBe("2026-10-12T01:02:00.000Z");
      expect(row.finishedAt).not.toBeNull();
      const points = await prisma.travTrackPoint.findMany({ where: { userId } });
      expect(new Set(points.map((p) => p.origin))).toEqual(new Set([`gpx:${importId}`]));
      expect(new Set(points.map((p) => p.deviceId))).toEqual(new Set([`file:${importId}`]));
      expect(points.every((p) => p.purpose === "everyday")).toBe(true);
    });

    it("a GPX point inside a privacy zone is dropped and counted", async () => {
      await prisma.travTrackPrivacyZone.create({
        data: { userId, name: "Home", lat: 37.5665, lon: 126.978, radiusM: 50 },
      });
      const { importId } = await importFile(gpxFile([minuteFixes("2026-10-12T01:00:00Z", 3)]));
      const row = await prisma.travTrackImport.findUniqueOrThrow({ where: { id: importId } });
      expect(row.report).toMatchObject({ stored: 2, dropped: { privacy_zone: 1 } });
      expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(2);
    });

    it("a GPX file into a deleted range stores nothing there", async () => {
      await prisma.travTrackDeletedRange.create({
        data: {
          userId,
          fromAt: new Date("2026-10-12T01:00:00Z"),
          toAt: new Date("2026-10-12T01:01:30Z"),
        },
      });
      const { importId } = await importFile(gpxFile([minuteFixes("2026-10-12T01:00:00Z", 3)]));
      const row = await prisma.travTrackImport.findUniqueOrThrow({ where: { id: importId } });
      expect(row.report).toMatchObject({ stored: 1, dropped: { deleted_range: 2 } });
      const left = await prisma.travTrackPoint.findMany({ where: { userId }, select: { t: true } });
      expect(left.map((p) => p.t.toISOString())).toEqual(["2026-10-12T01:02:00.000Z"]);
    });

    it("stores a large file in batches", async () => {
      const { importId } = await importFile(gpxFile([minuteFixes("2026-10-12T01:00:00Z", 7)]), {
        batchSize: 3,
      });
      const row = await prisma.travTrackImport.findUniqueOrThrow({ where: { id: importId } });
      expect(row.report).toMatchObject({ read: 7, stored: 7 });
    });

    it("a file without times fails with TRAVTRACK_IMPORT_NO_TIMES and stores nothing", async () => {
      const row = await prisma.travTrackImport.create({
        data: { userId, kind: "gpx", fileName: "plan.gpx", status: "running" },
      });
      const file = gpxFile([
        [
          { lat: 37.5, lon: 127.0 },
          { lat: 37.6, lon: 127.1 },
        ],
      ]);
      expect(await codeOf(runGpxImport(row.id, userId, { buffer: file }))).toBe(
        "TRAVTRACK_IMPORT_NO_TIMES"
      );
      const after = await prisma.travTrackImport.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.status).toBe("failed");
      expect(after.report).toMatchObject({ error: "TRAVTRACK_IMPORT_NO_TIMES", read: 2 });
      expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(0);
    });

    it("an unreadable file fails with TRAVTRACK_IMPORT_UNREADABLE", async () => {
      const row = await prisma.travTrackImport.create({
        data: { userId, kind: "gpx", fileName: "x.gpx", status: "running" },
      });
      expect(await codeOf(runGpxImport(row.id, userId, { buffer: Buffer.from("garbage") }))).toBe(
        "TRAVTRACK_IMPORT_UNREADABLE"
      );
      expect(await statusOf(row.id)).toBe("failed");
    });

    it("an import over last week creates no finding and no question", async () => {
      const lastWeek = new Date(Date.now() - 5 * 86_400_000).toISOString();
      // Two hours in one place: a stay, if anything looked.
      await importFile(
        gpxFile([minuteFixes(lastWeek, 120, 37.5665, 126.978).map((f) => ({ ...f, lon: 126.978 }))])
      );
      expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(0);
      expect(await prisma.locationSuggestion.count({ where: { userId } })).toBe(0);
    });
  });

  describe("deleting", () => {
    it("a GPX fix equal to a Companion fix is a duplicate; deleting the import leaves the Companion fix", async () => {
      await ingestTravTrackPoints({
        userId,
        deviceId: "phone-1",
        uploadId: "u1",
        points: [pt("c1", "2026-10-12T01:00:00Z")],
      });
      const { importId } = await importFile(gpxFile([minuteFixes("2026-10-12T01:00:00Z", 2)]));
      const row = await prisma.travTrackImport.findUniqueOrThrow({ where: { id: importId } });
      expect(row.report).toMatchObject({ stored: 1, duplicate: 1 });
      const { deleted } = await deleteTravTrackImport(userId, importId);
      expect(deleted).toBe(1);
      const left = await prisma.travTrackPoint.findMany({ where: { userId } });
      expect(left.map((p) => p.origin)).toEqual(["companion:phone-1"]);
    });

    it("deleting an import removes only its points and leaves no tombstone", async () => {
      const a = await importFile(gpxFile([minuteFixes("2026-10-12T01:00:00Z", 3)]));
      const b = await importFile(gpxFile([minuteFixes("2026-10-12T01:00:30Z", 3, 37.6, 127.1)]));
      await deleteTravTrackImport(userId, a.importId);
      const left = await prisma.travTrackPoint.findMany({ where: { userId } });
      expect(new Set(left.map((p) => p.origin))).toEqual(new Set([`gpx:${b.importId}`]));
      expect(await prisma.travTrackDeletedRange.count({ where: { userId } })).toBe(0);
      expect(await statusOf(a.importId)).toBe("cancelled");
      // No tombstone: the same file imported again is stored again.
      const again = await importFile(gpxFile([minuteFixes("2026-10-12T01:00:00Z", 3)]));
      expect(again.outcome.report).toMatchObject({ stored: 3 });
    });

    it("deleting a running import cancels it: no batch after the delete stores a point", async () => {
      const row = await prisma.travTrackImport.create({
        data: { userId, kind: "gpx", fileName: "long.gpx", status: "running" },
      });
      const batches: number[] = [];
      const outcome = await runGpxImport(
        row.id,
        userId,
        { buffer: gpxFile([minuteFixes("2026-10-12T01:00:00Z", 9)]) },
        {
          batchSize: 3,
          afterBatch: async (done) => {
            batches.push(done);
            if (done === 1) await deleteTravTrackImport(userId, row.id);
          },
        }
      );
      expect(outcome.status).toBe("cancelled");
      expect(batches).toEqual([1]);
      expect(await statusOf(row.id)).toBe("cancelled");
      expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(0);
    });

    it("an import of another account is not found", async () => {
      const other = await makeUser(`${PREFIX}b`);
      const { importId } = await importFile(gpxFile([minuteFixes("2026-10-12T01:00:00Z", 2)]));
      expect(await codeOf(deleteTravTrackImport(other, importId))).toBe(
        "TRAVTRACK_IMPORT_NOT_FOUND"
      );
      expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(2);
    });
  });

  describe("starting", () => {
    it("a second import while one runs is refused with TRAVTRACK_IMPORT_RUNNING", async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const file = gpxFile([minuteFixes("2026-10-12T01:00:00Z", 2)]);
      const first = await startGpxImport(
        userId,
        { buffer: file, originalName: "a.gpx" },
        { beforeRun: () => gate }
      );
      expect(first).toEqual({ jobId: expect.any(String), importId: expect.any(String) });
      expect(await codeOf(startGpxImport(userId, { buffer: file, originalName: "b.gpx" }))).toBe(
        "TRAVTRACK_IMPORT_RUNNING"
      );
      release();
      await settleAllJobs();
      expect(await statusOf(first.importId)).toBe("succeeded");
      const second = await startGpxImport(userId, { buffer: file, originalName: "b.gpx" });
      await settleAllJobs();
      expect(await statusOf(second.importId)).toBe("succeeded");
    });

    it("a running row no process works on (a restart) is interrupted, not a block", async () => {
      const stale = await prisma.travTrackImport.create({
        data: { userId, kind: "gpx", fileName: "old.gpx", status: "running" },
      });
      const file = gpxFile([minuteFixes("2026-10-12T01:00:00Z", 2)]);
      await startGpxImport(userId, { buffer: file, originalName: "new.gpx" });
      await settleAllJobs();
      expect(await statusOf(stale.id)).toBe("interrupted");
    });
  });
});
