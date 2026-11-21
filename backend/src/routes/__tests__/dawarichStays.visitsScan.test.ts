import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { setLocationProvider } from "../../services/locationProvider/provider";
import { markTravTrackDaysDirty } from "../../services/travtrack/dirtyDays";
import { storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import {
  clearVisitRetry,
  scheduledVisitSuggestions,
} from "../../services/travtrack/visits/project";

jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));

/**
 * `POST /dawarich-stays/visits/scan` (forgejo#316 slice 2): the last days'
 * TravTrack stops asked about venues now, as a job. Refused up front with the
 * code the client maps, and a failing lookup visible in the settings answer.
 */

const switches = travTrackSwitches();
let userId: string;
let cookie: string;

const post = (body: object = {}) =>
  request(app).post("/api/v1/dawarich-stays/visits/scan").set("Cookie", cookie).send(body);

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `visits-scan-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  cookie = `auth_token=${generateToken(userId)}`;
  await prisma.userSettings.create({
    data: { userId, data: {}, enabledDomains: ["poi"], locationProvider: "travtrack" },
  });
  await prisma.dawarichStayScan.create({ data: { userId, enabled: true } });
});

afterAll(async () => {
  await switches.restore();
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await switches.set({ beta: true, config: true });
  await setLocationProvider(userId, "travtrack");
  await prisma.userSettings.update({
    where: { userId },
    data: { enabledDomains: ["poi"], staySuggestionsEnabled: true },
  });
  await prisma.dawarichStayScan.update({ where: { userId }, data: { enabled: true } });
  clearVisitRetry();
});

describe("POST /dawarich-stays/visits/scan", () => {
  it("starts a job", async () => {
    const res = await post({ lookbackDays: 3 });
    expect(res.status).toBe(202);
    const jobId = res.body.data.jobId as string;
    let job: { status: string; result?: { status?: string } } = { status: "running" };
    for (let i = 0; i < 50 && job.status === "running"; i++) {
      job = (await request(app).get(`/api/v1/jobs/${jobId}`).set("Cookie", cookie)).body.data;
      if (job.status === "running") await new Promise((r) => setTimeout(r, 40));
    }
    expect(job.status).toBe("succeeded");
    expect(job.result?.status).toBe("done");
  });

  it("is refused while stay suggestions are switched off", async () => {
    await prisma.userSettings.update({
      where: { userId },
      data: { staySuggestionsEnabled: false },
    });
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("STAY_SUGGESTIONS_DISABLED");
  });

  it("is refused without the scan's consent", async () => {
    await prisma.dawarichStayScan.update({ where: { userId }, data: { enabled: false } });
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DAWARICH_SCAN_UNAVAILABLE");
  });

  it("is refused while the server's TravTrack is off", async () => {
    await switches.set({ beta: true, config: false });
    const res = await post();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
  });

  it("is refused for an account whose location source is not TravTrack", async () => {
    await prisma.userSettings.update({ where: { userId }, data: { locationProvider: "none" } });
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TRAVTRACK_UNAVAILABLE");
  });

  it("rejects an out-of-range window", async () => {
    expect((await post({ lookbackDays: 31 })).status).toBe(400);
  });
});

describe("GET /dawarich-stays/settings while the venue lookup fails", () => {
  it("says when the lookup will ask again, and says nothing while it works", async () => {
    const settings = async () =>
      (await request(app).get("/api/v1/dawarich-stays/settings").set("Cookie", cookie)).body.data;
    expect((await settings()).visitLookupRetryAt).toBeUndefined();

    await wipeTravTrack([userId]);
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    for (let i = 0; i <= 25; i++)
      await storePoint(userId, {
        t: Date.parse(`${day}T10:00:00Z`) + i * 60_000,
        lat: 37.5665,
        lon: 126.978,
      });
    await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, [day]));

    const run = await scheduledVisitSuggestions(userId, {
      resolveStop: async () => ({ kind: "failed", reason: "venues" }),
    });
    expect(run.failed.venues).toBe(1);
    const failing = await settings();
    expect(Date.parse(failing.visitLookupRetryAt)).toBeGreaterThan(Date.now());
  });
});
