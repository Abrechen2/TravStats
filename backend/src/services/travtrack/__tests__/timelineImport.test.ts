import fs from "node:fs";

import express from "express";
import multer from "multer";
import request from "supertest";

import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { settleAllJobs } from "../../jobs/jobRegistry";
import { runGpxImport, startGpxImport } from "../imports/fileImport";
import { SPOOL_DIR, spoolStorage } from "../imports/spool";
import { READER_QUEUE_MAX, readerQueueFull } from "../imports/trackFileChild";
import {
  readTrackFile,
  sniffFormat,
  TIMELINE_IMPORT_MAX_POINTS,
  JSON_IMPORT_MAX_BYTES,
} from "../imports/trackFile";
import { ingestTravTrackPoints } from "../ingest";
import { makeUser, pt, wipeTravTrack } from "./fixtures";

/**
 * Google Timeline, GeoJSON, KML and TCX files into TravTrack (forgejo#394).
 * Every fixture is synthetic: invented coordinates (Seoul), invented times,
 * shaped like the real exports (field names: see `timelineChildSource.ts`).
 */

const PREFIX = "travtrack-timeline-";
const json = (v: unknown) => Buffer.from(JSON.stringify(v));

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    return err instanceof AppError ? err.code : String(err);
  }
};

/** Home in the invented Seoul grid; the zone test puts a privacy zone on it. */
const HOME = { lat: 37.5665, lon: 126.978 };
const e7 = (deg: number) => Math.round(deg * 1e7);

describe("TravTrack — Google Timeline and other track files", () => {
  let userId: string;

  async function importFile(buffer: Buffer, opts: Parameters<typeof runGpxImport>[3] = {}) {
    const row = await prisma.travTrackImport.create({
      data: { userId, kind: "gpx", fileName: "timeline.json", status: "running" },
    });
    const outcome = await runGpxImport(row.id, userId, { buffer }, opts);
    return { importId: row.id, outcome };
  }

  const stored = () => prisma.travTrackPoint.findMany({ where: { userId }, orderBy: { t: "asc" } });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await settleAllJobs();
    await wipeTravTrack([userId]);
    await prisma.travTrackImport.deleteMany({ where: { userId } });
    await prisma.travTrackPrivacyZone.deleteMany({ where: { userId } });
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await settleAllJobs();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  describe("Records.json (old Location History)", () => {
    const records = {
      locations: [
        {
          latitudeE7: e7(37.5),
          longitudeE7: e7(127.0),
          accuracy: 12,
          altitude: 40,
          velocity: 3,
          heading: 90,
          timestamp: "2026-10-12T01:00:00.123Z",
          activity: [
            {
              timestamp: "2026-10-12T01:00:01Z",
              activity: [
                { type: "STILL", confidence: 10 },
                { type: "ON_FOOT", confidence: 80 },
              ],
            },
          ],
        },
        // The oldest exports carry epoch milliseconds in a string, and no accuracy.
        { latitudeE7: e7(37.51), longitudeE7: e7(127.01), timestampMs: "1760230860000" },
        // No offset: the host's zone is not guessed, so this is a fix without a time.
        { latitudeE7: e7(37.52), longitudeE7: e7(127.02), timestamp: "2026-10-12T01:02:00" },
        { latitudeE7: e7(95), longitudeE7: e7(127.03), timestamp: "2026-10-12T01:03:00Z" },
      ],
    };

    it("reads positions, abstains on what the file lacks, and does not guess a zone", async () => {
      expect(sniffFormat(json(records))).toBe("json");
      const { importId, outcome } = await importFile(json(records));
      expect(outcome.report).toMatchObject({
        format: "google-records",
        read: 4,
        stored: 2,
        withoutTime: 1,
        dropped: { invalid: 1 },
      });
      const rows = await stored();
      expect(rows.map((r) => r.t.toISOString())).toEqual([
        "2025-10-12T01:01:00.000Z",
        "2026-10-12T01:00:00.123Z",
      ]);
      const first = rows.find((r) => r.t.toISOString().startsWith("2026"))!;
      expect(first).toMatchObject({ accuracyM: 12, altitudeM: 40, speedMps: 3, course: 90 });
      expect(first.motion).toBe("walking");
      const bare = rows.find((r) => r.t.toISOString().startsWith("2025"))!;
      // Missing accuracy stays unknown rather than becoming 0.
      expect(bare.accuracyM).toBeNull();
      expect(bare.motion).toBeNull();
      expect(first.origin).toBe(`gpx:${importId}`);
    });

    it("an unfinished file (cut off mid-array) is refused as unreadable and the import fails with it", async () => {
      const cut = Buffer.from(JSON.stringify(records).slice(0, 150));
      expect(await codeOf(readTrackFile(cut))).toBe("TRAVTRACK_IMPORT_UNREADABLE");
      const row = await prisma.travTrackImport.create({
        data: { userId, kind: "gpx", fileName: "cut.json", status: "running" },
      });
      await expect(runGpxImport(row.id, userId, { buffer: cut })).rejects.toBeInstanceOf(AppError);
      const after = await prisma.travTrackImport.findUniqueOrThrow({ where: { id: row.id } });
      expect(after).toMatchObject({
        status: "failed",
        report: expect.objectContaining({ error: "TRAVTRACK_IMPORT_UNREADABLE" }),
      });
    });

    it("scans a file larger than one read slice, including multi-byte text across the seam", async () => {
      const filler = "ü".repeat(40);
      const locations = Array.from({ length: 50_000 }, (_, i) => ({
        latitudeE7: e7(37 + (i % 1000) * 0.0001),
        longitudeE7: e7(127 + Math.floor(i / 1000) * 0.0001),
        timestamp: new Date(Date.parse("2026-10-12T00:00:00Z") + i * 1000).toISOString(),
        deviceTag: filler,
      }));
      const file = json({ locations });
      expect(file.length).toBeGreaterThan(5 * 1024 * 1024);
      const { track } = await readTrackFile(file);
      expect(track.count).toBe(50_000);
      expect(track.invalid).toBe(0);
    });

    it("refuses a file over the point cap with TRAVTRACK_IMPORT_TOO_MANY_POINTS", async () => {
      expect(TIMELINE_IMPORT_MAX_POINTS).toBe(2_000_000);
      expect(await codeOf(readTrackFile(json(records), { maxPoints: 2 }))).toBe(
        "TRAVTRACK_IMPORT_TOO_MANY_POINTS"
      );
    });
  });

  describe("Semantic Location History", () => {
    const month = {
      timelineObjects: [
        {
          placeVisit: {
            location: { latitudeE7: e7(37.5), longitudeE7: e7(127), accuracyMetres: 20 },
            duration: {
              startTimestamp: "2026-10-12T01:00:00Z",
              endTimestamp: "2026-10-12T02:00:00Z",
            },
          },
        },
        {
          activitySegment: {
            startLocation: { latitudeE7: e7(37.5), longitudeE7: e7(127) },
            endLocation: { latitudeE7: e7(37.6), longitudeE7: e7(127.1) },
            duration: {
              startTimestamp: "2026-10-12T02:00:00Z",
              endTimestamp: "2026-10-12T02:30:00Z",
            },
            activityType: "IN_PASSENGER_VEHICLE",
            simplifiedRawPath: {
              points: [
                {
                  latE7: e7(37.55),
                  lngE7: e7(127.05),
                  accuracyMeters: 8,
                  timestamp: "2026-10-12T02:15:00Z",
                },
              ],
            },
            waypointPath: { waypoints: [{ latE7: e7(37.52), lngE7: e7(127.02) }] },
          },
        },
      ],
    };

    it("reads visits, segment ends and the raw path; waypoints without a time are not stored", async () => {
      const { outcome } = await importFile(json(month));
      expect(outcome.report).toMatchObject({
        format: "google-semantic",
        stored: 4,
        withoutTime: 1,
      });
      const rows = await stored();
      expect(rows.map((r) => r.t.toISOString())).toEqual([
        "2026-10-12T01:00:00.000Z",
        "2026-10-12T02:00:00.000Z",
        "2026-10-12T02:15:00.000Z",
        "2026-10-12T02:30:00.000Z",
      ]);
      expect(rows[0].accuracyM).toBe(20);
      expect(rows[2]).toMatchObject({ accuracyM: 8, motion: "automotive" });
    });
  });

  describe("on-device Timeline export", () => {
    const device = {
      semanticSegments: [
        {
          startTime: "2026-10-12T10:00:00.000+09:00",
          endTime: "2026-10-12T10:30:00.000+09:00",
          timelinePath: [
            { point: "37.5000°, 127.0000°", time: "2026-10-12T10:05:00.000+09:00" },
            { point: "37.5100°, 127.0100°", time: "2026-10-12T10:10:00.000+09:00" },
          ],
        },
        {
          startTime: "2026-10-12T11:00:00.000+09:00",
          endTime: "2026-10-12T11:20:00.000+09:00",
          visit: { topCandidate: { placeLocation: { latLng: "37.5600°, 127.9000°" } } },
        },
        {
          startTime: "2026-10-12T12:00:00.000+09:00",
          endTime: "2026-10-12T12:20:00.000+09:00",
          activity: {
            start: { latLng: "37.6000°, 127.0000°" },
            end: { latLng: "37.7000°, 127.1000°" },
            topCandidate: { type: "in passenger vehicle" },
          },
        },
      ],
      rawSignals: [
        {
          position: {
            LatLng: "37.5200°, 127.0200°",
            accuracyMeters: 15,
            altitudeMeters: 33,
            speedMetersPerSecond: 1.5,
            timestamp: "2026-10-12T10:07:00.000+09:00",
            source: "GPS",
          },
        },
        { wifiScan: { deliveryTime: "2026-10-12T10:07:00.000+09:00" } },
      ],
      userLocationProfile: { frequentPlaces: [{ placeLocation: "geo:37.5,127.0", label: "HOME" }] },
    };

    it("keeps each time as the instant the offset names and reads all four segment kinds", async () => {
      const { outcome } = await importFile(json(device));
      expect(outcome.report).toMatchObject({
        format: "google-timeline",
        stored: 6,
        withoutTime: 0,
      });
      const rows = await stored();
      // 10:05+09:00 is 01:05Z — the offset is applied, not dropped.
      expect(rows[0].t.toISOString()).toBe("2026-10-12T01:00:00.000Z".replace("01:00", "01:05"));
      const raw = rows.find((r) => r.accuracyM === 15)!;
      expect(raw).toMatchObject({ altitudeM: 33, speedMps: 1.5 });
      expect(rows.filter((r) => r.motion === "automotive")).toHaveLength(2);
      // Path points carry no accuracy: unknown, not 0.
      expect(rows[0].accuracyM).toBeNull();
    });

    it("reads the older Android array form with geo: strings and minute offsets", async () => {
      const legacy = [
        {
          startTime: "2026-10-12T01:00:00.000Z",
          endTime: "2026-10-12T01:30:00.000Z",
          timelinePath: [
            { point: "geo:37.5,127.0", durationMinutesOffsetFromStartTime: "5" },
            { point: "geo:37.51,127.01", durationMinutesOffsetFromStartTime: "10" },
          ],
        },
        {
          startTime: "2026-10-12T02:00:00.000Z",
          endTime: "2026-10-12T02:10:00.000Z",
          visit: { topCandidate: { placeLocation: "geo:37.55,127.05" } },
        },
      ];
      const { outcome } = await importFile(json(legacy));
      expect(outcome.report).toMatchObject({ stored: 3, format: "google-timeline" });
      expect((await stored()).map((r) => r.t.toISOString())).toEqual([
        "2026-10-12T01:05:00.000Z",
        "2026-10-12T01:10:00.000Z",
        "2026-10-12T02:00:00.000Z",
      ]);
    });
  });

  describe("GeoJSON, KML and TCX", () => {
    it("reads a GeoJSON LineString with coordTimes; a line without times is not history", async () => {
      const fc = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { coordTimes: ["2026-10-12T01:00:00Z", "2026-10-12T01:01:00Z"] },
            geometry: {
              type: "LineString",
              coordinates: [
                [127.0, 37.5, 30],
                [127.01, 37.51, 31],
              ],
            },
          },
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: [
                [127.5, 37.9],
                [127.6, 37.95],
              ],
            },
          },
        ],
      };
      const { outcome } = await importFile(json(fc));
      expect(outcome.report).toMatchObject({ format: "geojson", stored: 2, withoutTime: 2 });
      expect((await stored())[0]).toMatchObject({ altitudeM: 30 });
    });

    it("reads a KML gx:Track and a time-stamped placemark", async () => {
      const kml =
        `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Placemark>` +
        `<gx:Track><when>2026-10-12T01:00:00Z</when><when>2026-10-12T01:01:00Z</when>` +
        `<gx:coord>127.0 37.5 20</gx:coord><gx:coord>127.01 37.51 21</gx:coord></gx:Track></Placemark>` +
        `<Placemark><TimeStamp><when>2026-10-12T03:00:00+09:00</when></TimeStamp><Point><coordinates>127.2,37.7,0</coordinates></Point></Placemark>` +
        `<Placemark><LineString><coordinates>127.0,37.5 127.1,37.6</coordinates></LineString></Placemark>` +
        `</Document></kml>`;
      expect(sniffFormat(Buffer.from(kml))).toBe("kml");
      const { outcome } = await importFile(Buffer.from(kml));
      expect(outcome.report).toMatchObject({ format: "kml", stored: 3 });
      expect((await stored()).map((r) => r.t.toISOString())).toEqual([
        "2026-10-11T18:00:00.000Z",
        "2026-10-12T01:00:00.000Z",
        "2026-10-12T01:01:00.000Z",
      ]);
    });

    it("reads TCX trackpoints and skips one without a position", async () => {
      const tcx =
        `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Lap><Track>` +
        `<Trackpoint><Time>2026-10-12T01:00:00Z</Time><Position><LatitudeDegrees>37.5</LatitudeDegrees><LongitudeDegrees>127.0</LongitudeDegrees></Position><AltitudeMeters>30</AltitudeMeters></Trackpoint>` +
        `<Trackpoint><Time>2026-10-12T01:00:05Z</Time><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>` +
        `<Trackpoint><Time>2026-10-12T01:00:10Z</Time><Position><LatitudeDegrees>37.5001</LatitudeDegrees><LongitudeDegrees>127.0001</LongitudeDegrees></Position></Trackpoint>` +
        `</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
      const { outcome } = await importFile(Buffer.from(tcx));
      expect(outcome.report).toMatchObject({ format: "tcx", stored: 2 });
    });

    it("refuses a KML with a document type declaration", async () => {
      const evil = `<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY a "aaaa">]><kml><Document/></kml>`;
      expect(await codeOf(readTrackFile(Buffer.from(evil)))).toBe("TRAVTRACK_IMPORT_UNREADABLE");
    });

    it("recognises FIT and refuses it by its own code instead of calling it unreadable", async () => {
      const fit = Buffer.alloc(32);
      fit.write(".FIT", 8, "latin1");
      expect(sniffFormat(fit)).toBe("fit");
      expect(await codeOf(readTrackFile(fit))).toBe("TRAVTRACK_IMPORT_UNSUPPORTED_FORMAT");
      expect(await codeOf(readTrackFile(Buffer.from("just text")))).toBe(
        "TRAVTRACK_IMPORT_UNREADABLE"
      );
    });
  });

  describe("the rules every import shares", () => {
    const records = {
      locations: [0, 1, 2].map((i) => ({
        latitudeE7: e7(HOME.lat + i * 0.01),
        longitudeE7: e7(HOME.lon),
        timestamp: new Date(Date.parse("2026-10-12T01:00:00Z") + i * 60_000).toISOString(),
      })),
    };

    it("drops a Timeline fix inside a privacy zone and counts it", async () => {
      await prisma.travTrackPrivacyZone.create({
        data: { userId, name: "Home", lat: HOME.lat, lon: HOME.lon, radiusM: 50 },
      });
      const { outcome } = await importFile(json(records));
      expect(outcome.report).toMatchObject({ stored: 2, dropped: { privacy_zone: 1 } });
      expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(2);
    });

    it("the same file imported twice adds nothing the second time", async () => {
      await importFile(json(records));
      const again = await importFile(json(records));
      expect(again.outcome.report).toMatchObject({ stored: 0, duplicate: 3 });
      expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(3);
    });

    it("a fix the phone already sent is a duplicate of the file's", async () => {
      await ingestTravTrackPoints({
        userId,
        deviceId: "phone",
        uploadId: "u1",
        points: [pt("p1", "2026-10-12T01:00:00Z", HOME.lat, HOME.lon)],
      });
      const { outcome } = await importFile(json(records));
      expect(outcome.report).toMatchObject({ stored: 2, duplicate: 1 });
    });

    it("reports progress that rises to 100 while the import runs", async () => {
      const seen: number[] = [];
      await importFile(json(records), { batchSize: 1, onProgress: (p) => seen.push(p) });
      expect(seen.length).toBeGreaterThan(2);
      expect(seen[seen.length - 1]).toBe(100);
      expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    });

    it("refuses an oversized file with TRACK_FILE_TOO_LARGE before any import row exists", async () => {
      expect(JSON_IMPORT_MAX_BYTES).toBe(200 * 1024 * 1024);
      const big = json(records);
      expect(
        await codeOf(
          startGpxImport(
            userId,
            { buffer: big, originalName: "r.json" },
            { maxBytes: { json: 10 } }
          )
        )
      ).toBe("TRACK_FILE_TOO_LARGE");
      const xml = Buffer.from(`<gpx>${" ".repeat(100)}</gpx>`);
      expect(
        await codeOf(
          startGpxImport(userId, { buffer: xml, originalName: "r.gpx" }, { maxBytes: { xml: 10 } })
        )
      ).toBe("TRACK_FILE_TOO_LARGE");
      expect(await prisma.travTrackImport.count({ where: { userId } })).toBe(0);
    });
  });

  describe("memory safety of the upload (security review, forgejo#394)", () => {
    const spooled = () => (fs.existsSync(SPOOL_DIR) ? fs.readdirSync(SPOOL_DIR) : []);
    const records = json({
      locations: [
        { latitudeE7: e7(37.5), longitudeE7: e7(127), timestamp: "2026-10-12T01:00:00Z" },
      ],
    });

    it("an upload is judged while it streams: a non-JSON file past the XML cap is aborted with 413", async () => {
      const app = express();
      const up = multer({ storage: spoolStorage({ xmlCap: 1000 }) });
      app.post("/up", up.single("file"), (req, res) => {
        res.json({ size: req.file?.size });
      });
      app.use(
        (
          err: AppError,
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction
        ) => {
          res.status(err.statusCode ?? 500).json({ code: err.code });
        }
      );
      const before = spooled();
      const xml = Buffer.from(`<gpx>${" ".repeat(5000)}</gpx>`);
      const refused = await request(app).post("/up").attach("file", xml, "big.gpx");
      expect(refused.status).toBe(413);
      expect(refused.body.code).toBe("TRACK_FILE_TOO_LARGE");
      // Nothing of the aborted file stays on disk.
      expect(spooled()).toEqual(before);
      // The same size as JSON is allowed: its cap is the larger one.
      const bigJson = Buffer.from(JSON.stringify({ locations: [], pad: "x".repeat(5000) }));
      const ok = await request(app).post("/up").attach("file", bigJson, "Records.json");
      expect(ok.status).toBe(200);
      expect(ok.body.size).toBe(bigJson.length);
      for (const f of spooled()) if (!before.includes(f)) fs.rmSync(`${SPOOL_DIR}/${f}`);
    });

    it("the spooled file is removed when the job ends, and when the import is refused", async () => {
      const before = spooled();
      const started = await startGpxImport(userId, { buffer: records, originalName: "r.json" });
      await settleAllJobs();
      expect(started.jobId).toBeTruthy();
      expect(spooled()).toEqual(before);
      // Refused by size: no row, no file.
      await expect(
        startGpxImport(
          userId,
          { buffer: records, originalName: "r.json" },
          { maxBytes: { json: 5 } }
        )
      ).rejects.toMatchObject({ code: "TRACK_FILE_TOO_LARGE" });
      expect(spooled()).toEqual(before);
    });

    it("refuses when the reader's line is full, with a stable code, and leaves nothing behind", async () => {
      const before = spooled();
      const rowsBefore = await prisma.travTrackImport.count({ where: { userId } });
      const inFlight = Array.from({ length: READER_QUEUE_MAX }, () => readTrackFile(records));
      // Each read spools its bytes first; wait until all of them stand in the line.
      for (let i = 0; i < 200 && !readerQueueFull(); i++)
        await new Promise((r) => setTimeout(r, 5));
      expect(readerQueueFull()).toBe(true);
      expect(await codeOf(readTrackFile(records))).toBe("TRAVTRACK_IMPORT_BUSY");
      expect(
        await codeOf(startGpxImport(userId, { buffer: records, originalName: "r.json" }))
      ).toBe("TRAVTRACK_IMPORT_BUSY");
      expect(await prisma.travTrackImport.count({ where: { userId } })).toBe(rowsBefore);
      await Promise.all(inFlight);
      expect(spooled()).toEqual(before);
      // The line drains: a read is accepted again.
      expect((await readTrackFile(records)).track.count).toBe(1);
    });
  });
});
