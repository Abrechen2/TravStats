import request from "supertest";
import { jest } from "@jest/globals";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { encryptApiKey } from "../../utils/encryption";
import { settleAllJobs } from "../../services/jobs/jobRegistry";
import { travTrackImportLimiter } from "../../middleware/travTrackImportLimiter";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * The Dawarich copy over HTTP (TravTrack plan L6): started by the user with
 * the account's own connection, read only from Dawarich (the fake `fetch`
 * sees GETs of /api/v1/points and nothing else), its report readable, its
 * points deletable as one import. Starting needs TravTrack on; the state
 * stays readable for an account holding data while it is off.
 */

const PREFIX = "travtrack-dwcopy-route-";

const rows = [
  { id: 11, at: "2026-03-30T08:00:00Z", lat: 37.5, lon: 127 },
  { id: 12, at: "2026-03-30T09:00:00Z", lat: 37.51, lon: 127.01 },
  { id: 13, at: "2026-04-02T10:00:00Z", lat: 33.4, lon: 126.5 },
];

describe("TravTrack — /travtrack/imports/dawarich", () => {
  const switches = travTrackSwitches();
  const realFetch = global.fetch;
  let userId: string;
  let cookie: string;
  let fetchSpy: jest.Mock<typeof fetch>;

  const range = { fromDay: "2026-03-29", untilDay: "2026-04-03" };
  const start = (body: object = range) =>
    request(app).post("/api/v1/travtrack/imports/dawarich").set("Cookie", cookie).send(body);
  const view = () => request(app).get("/api/v1/travtrack/imports/dawarich").set("Cookie", cookie);

  async function withConnection() {
    const data = { dawarichBaseUrl: "http://dawarich.test", dawarichApiKey: encryptApiKey("k") };
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, data: {}, ...data },
      update: data,
    });
  }

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await settleAllJobs();
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.travTrackDawarichImport.deleteMany({ where: { userId } });
    await prisma.travTrackImport.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await travTrackImportLimiter.resetKey(`user:${userId}`);
    fetchSpy = jest.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      const from = Date.parse(url.searchParams.get("start_at") ?? "");
      const to = Date.parse(url.searchParams.get("end_at") ?? "");
      const body =
        Number(url.searchParams.get("page")) > 1
          ? []
          : rows
              .filter((r) => Date.parse(r.at) >= from && Date.parse(r.at) <= to)
              .reverse()
              .map((r) => ({
                id: r.id,
                latitude: String(r.lat),
                longitude: String(r.lon),
                timestamp: Date.parse(r.at) / 1000,
              }));
      return new Response(JSON.stringify(body), { status: 200 });
    });
    global.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterAll(async () => {
    await settleAllJobs();
    global.fetch = realFetch;
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("copies with the own connection, reports per month, and only ever GETs points", async () => {
    await withConnection();
    const res = await start();
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ jobId: expect.any(String), importId: expect.any(String) });
    await settleAllJobs();
    const job = await request(app).get(`/api/v1/jobs/${res.body.jobId}`).set("Cookie", cookie);
    expect(job.body.data).toMatchObject({
      kind: "travtrack.dawarichImport",
      status: "succeeded",
      result: { importId: res.body.importId, status: "complete" },
    });
    const state = await view();
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({
      connection: "own",
      copy: {
        importId: res.body.importId,
        status: "complete",
        totals: { read: 3, stored: 3, duplicate: 0 },
        months: [
          expect.objectContaining({ month: "2026-03", stored: 2 }),
          expect.objectContaining({ month: "2026-04", stored: 1 }),
        ],
      },
    });
    for (const [input, init] of fetchSpy.mock.calls) {
      expect(new URL(String(input)).pathname).toBe("/api/v1/points");
      expect(init?.method ?? "GET").toBe("GET");
      expect(init?.body).toBeUndefined();
    }
    const list = await request(app).get("/api/v1/travtrack/imports").set("Cookie", cookie);
    expect(list.body.imports).toEqual([
      expect.objectContaining({
        id: res.body.importId,
        kind: "dawarich",
        status: "succeeded",
        pointCount: 3,
      }),
    ]);
  });

  it("deleting the copy's import removes only its points", async () => {
    await withConnection();
    const { body } = await start();
    await settleAllJobs();
    const del = await request(app)
      .delete(`/api/v1/travtrack/imports/${body.importId}`)
      .set("Cookie", cookie);
    expect(del.body).toEqual({ deleted: 3 });
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(0);
    expect((await view()).body.copy.status).toBe("cancelled");
    const resume = await request(app)
      .post("/api/v1/travtrack/imports/dawarich/resume")
      .set("Cookie", cookie);
    expect(resume.status).toBe(409);
    expect(resume.body.code).toBe("TRAVTRACK_IMPORT_NOT_RESUMABLE");
  });

  it("refuses without an own connection, says which one there is, and never calls Dawarich", async () => {
    await prisma.adminSettings.updateMany({
      data: {
        globalDawarichBaseUrl: "http://shared.test",
        globalDawarichApiKey: encryptApiKey("shared-dawarich-key-123"),
      },
    });
    try {
      const res = await start();
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DAWARICH_NOT_CONFIGURED");
      expect((await view()).body).toEqual({ connection: "shared", copy: null });
    } finally {
      await prisma.adminSettings.updateMany({
        data: { globalDawarichBaseUrl: null, globalDawarichApiKey: null },
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("validates the range: both days or neither", async () => {
    await withConnection();
    const res = await start({ fromDay: "2026-03-29" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("stop with nothing running is 409, resume with no copy is 404", async () => {
    await withConnection();
    const stop = await request(app)
      .post("/api/v1/travtrack/imports/dawarich/stop")
      .set("Cookie", cookie);
    expect(stop.status).toBe(409);
    expect(stop.body.code).toBe("TRAVTRACK_IMPORT_NOT_RUNNING");
    const resume = await request(app)
      .post("/api/v1/travtrack/imports/dawarich/resume")
      .set("Cookie", cookie);
    expect(resume.status).toBe(404);
    expect(resume.body.code).toBe("TRAVTRACK_IMPORT_NOT_FOUND");
  });

  it("TravTrack off: starting is 403; with data held the state stays readable", async () => {
    await withConnection();
    await start();
    await settleAllJobs();
    await switches.set({ beta: true, config: false });
    const res = await start();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
    const state = await view();
    expect(state.status).toBe(200);
    expect(state.body.copy.status).toBe("complete");
  });
});
