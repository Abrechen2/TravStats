import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { shareSnapshotBuildLimiter } from "../../middleware/shareSnapshotBuildLimit";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { settleAllJobs } from "../../services/jobs/jobRegistry";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import {
  makeTrip,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../services/travtrack/__tests__/fixtures";
import { gpxFile, minuteFixes } from "../../services/travtrack/__tests__/gpxFixtures";
import { GPX_IMPORT_MAX_BYTES } from "../../services/travtrack/imports/mapGpx";

/**
 * GPX files into TravTrack over HTTP (TravTrack plan E8): a multipart upload
 * answers 202 with a job, the job's failure reaches the client as its code,
 * the list carries each import's report and point count, and a delete takes
 * the import's points with it — also out of a shared trip's route. With
 * TravTrack off, an account holding data still lists and deletes.
 */

const PREFIX = "travtrack-imports-";

describe("TravTrack — /travtrack/imports", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;
  let otherCookie: string;

  const upload = (file: Buffer, name = "walk.gpx", auth: [string, string] = ["Cookie", cookie]) =>
    request(app).post("/api/v1/travtrack/imports").set(auth[0], auth[1]).attach("file", file, name);

  const list = (c = cookie) => request(app).get("/api/v1/travtrack/imports").set("Cookie", c);

  async function importDone(file: Buffer, name = "walk.gpx") {
    const res = await upload(file, name);
    expect(res.status).toBe(202);
    await settleAllJobs();
    return res.body as { jobId: string; importId: string };
  }

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
    otherCookie = `auth_token=${generateToken(otherId)}`;
  });

  beforeEach(async () => {
    await settleAllJobs();
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId, otherId]);
    await prisma.travTrackImport.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.apiToken.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await settleAllJobs();
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("takes a GPX file, answers 202 with a job, and lists the import with its report", async () => {
    const { jobId, importId } = await importDone(
      gpxFile([minuteFixes("2026-10-12T01:00:00Z", 4)]),
      "../Wanderung Bukhansan.gpx"
    );
    const job = await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", cookie);
    expect(job.body.data).toMatchObject({
      kind: "travtrack.fileImport",
      status: "succeeded",
      result: { importId, status: "succeeded" },
    });
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.imports).toEqual([
      {
        id: importId,
        kind: "gpx",
        fileName: "Wanderung Bukhansan.gpx",
        status: "succeeded",
        report: {
          read: 4,
          stored: 4,
          duplicate: 0,
          dropped: { privacy_zone: 0, deleted_range: 0, invalid: 0, null_island: 0 },
          withoutTime: 0,
        },
        pointCount: 4,
        fromAt: "2026-10-12T01:00:00.000Z",
        toAt: "2026-10-12T01:03:00.000Z",
        createdAt: expect.any(String),
        finishedAt: expect.any(String),
      },
    ]);
  });

  it("a file without times fails the job with TRAVTRACK_IMPORT_NO_TIMES", async () => {
    const { jobId } = await importDone(
      gpxFile([
        [
          { lat: 37.5, lon: 127 },
          { lat: 37.6, lon: 127.1 },
        ],
      ])
    );
    const job = await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", cookie);
    expect(job.body.data).toMatchObject({
      status: "failed",
      error: { code: "TRAVTRACK_IMPORT_NO_TIMES", status: 422 },
    });
    const [row] = (await list()).body.imports;
    expect(row).toMatchObject({ status: "failed", report: { error: "TRAVTRACK_IMPORT_NO_TIMES" } });
  });

  it("an unreadable file fails the job with TRAVTRACK_IMPORT_UNREADABLE", async () => {
    const { jobId } = await importDone(Buffer.from("<html>nope</html>"), "x.gpx");
    const job = await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", cookie);
    expect(job.body.data.error).toEqual({ code: "TRAVTRACK_IMPORT_UNREADABLE", status: 422 });
  });

  it("refuses a request without a file, and a file over the limit", async () => {
    const none = await request(app)
      .post("/api/v1/travtrack/imports")
      .set("Cookie", cookie)
      .field("x", "y");
    expect(none.status).toBe(400);
    expect(none.body.code).toBe("VALIDATION_FAILED");
    const big = await upload(Buffer.alloc(GPX_IMPORT_MAX_BYTES + 1, 0x20));
    expect(big.status).toBe(413);
    expect(big.body.code).toBe("TRACK_FILE_TOO_LARGE");
    expect(await prisma.travTrackImport.count({ where: { userId } })).toBe(0);
  });

  it("needs write scope", async () => {
    const t = await generateApiToken();
    await prisma.apiToken.create({
      data: { userId, label: "ro", lookupHash: t.lookupHash, hash: t.hash, scope: "read" },
    });
    const res = await upload(gpxFile([minuteFixes("2026-10-12T01:00:00Z", 2)]), "a.gpx", [
      "Authorization",
      `Bearer ${t.plaintext}`,
    ]);
    expect(res.status).toBe(403);
    expect(await prisma.travTrackImport.count({ where: { userId } })).toBe(0);
  });

  it("the summary lists the file as a device, with its file name", async () => {
    const { importId } = await importDone(
      gpxFile([minuteFixes("2026-10-12T01:00:00Z", 3)]),
      "Seoul.gpx"
    );
    await storePoint(userId, { t: Date.parse("2026-10-13T01:00:00Z"), lat: 1, lon: 1 });
    const res = await request(app).get("/api/v1/travtrack/summary").set("Cookie", cookie);
    expect(res.body.devices).toEqual(
      expect.arrayContaining([
        { deviceId: `file:${importId}`, pointCount: 3, fileName: "Seoul.gpx" },
        expect.objectContaining({ pointCount: 1, fileName: null }),
      ])
    );
  });

  it("deletes an import's points, keeps its row as cancelled, and keeps others' imports apart", async () => {
    const { importId } = await importDone(gpxFile([minuteFixes("2026-10-12T01:00:00Z", 3)]));
    const stranger = await request(app)
      .delete(`/api/v1/travtrack/imports/${importId}`)
      .set("Cookie", otherCookie);
    expect(stranger.status).toBe(404);
    expect(stranger.body.code).toBe("TRAVTRACK_IMPORT_NOT_FOUND");
    expect((await list(otherCookie)).body.imports).toEqual([]);

    const res = await request(app)
      .delete(`/api/v1/travtrack/imports/${importId}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 3 });
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(0);
    const [row] = (await list()).body.imports;
    expect(row).toMatchObject({ id: importId, status: "cancelled", pointCount: 0 });
  });

  it("TravTrack off: import 403, list and delete reachable for an account holding data", async () => {
    const { importId } = await importDone(gpxFile([minuteFixes("2026-10-12T01:00:00Z", 2)]));
    await switches.set({ beta: true, config: false });
    const res = await upload(gpxFile([minuteFixes("2026-10-13T01:00:00Z", 2)]));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
    expect((await list()).status).toBe(200);
    const del = await request(app)
      .delete(`/api/v1/travtrack/imports/${importId}`)
      .set("Cookie", cookie);
    expect(del.body).toEqual({ deleted: 2 });
  });

  it("TravTrack off: an account whose only data is a failed import still reaches the list", async () => {
    await importDone(Buffer.from("garbage"), "broken.gpx");
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(0);
    await switches.set({ beta: true, config: false });
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.imports).toEqual([expect.objectContaining({ status: "failed" })]);
  });

  it("deleting an import takes its points out of a shared trip's route", async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await shareSnapshotBuildLimiter.resetKey(`user:${userId}`);
    const tripId = await makeTrip(userId);
    // A Companion walk in the morning, the file in the afternoon (Seoul trip, 12 Oct).
    for (let i = 0; i < 20; i++) {
      await storePoint(userId, {
        t: Date.parse("2026-10-12T00:00:00Z") + i * 60_000,
        lat: 37.5 + (i % 2) * 0.001,
        lon: 127.0 + i * 0.002,
      });
    }
    const file = minuteFixes("2026-10-12T05:00:00Z", 20, 37.6, 127.2).map((f, i) => ({
      ...f,
      lat: 37.6 + (i % 2) * 0.001,
    }));
    const { importId } = await importDone(gpxFile([file]));
    const shared = await request(app)
      .put(`/api/v1/trips/${tripId}/share-snapshot`)
      .set("Cookie", cookie);
    expect(shared.status).toBe(200);
    const fileStart = Date.parse("2026-10-12T05:00:00Z");
    const timesOf = async () => {
      const row = await prisma.travTrackShareSnapshot.findUniqueOrThrow({ where: { tripId } });
      return (row.geometry as number[][][]).flat().map((v) => v[2]);
    };
    expect((await timesOf()).some((t) => t >= fileStart)).toBe(true);

    await request(app)
      .delete(`/api/v1/travtrack/imports/${importId}`)
      .set("Cookie", cookie)
      .expect(200);
    const after = await timesOf();
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((t) => t >= fileStart)).toBe(false);
  });
});
