import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { settleAllJobs } from "../../services/jobs/jobRegistry";
import { wrappedTiming } from "../../services/stats/wrappedRequest";
import {
  cachedTravTrackPart,
  clearWrappedTravTrackCache,
  travTrackFingerprint,
} from "../../services/stats/wrappedTravTrackCache";

/**
 * UAT rc.45 M1: `/stats/wrapped` took 14–36 s on a large account and the web
 * client gives up after 10 s. A story slower than the sync budget now runs as
 * a job the client polls, and the slow TravTrack half is kept until its inputs
 * change.
 */
describe("GET /api/v1/stats/wrapped — slow stories run as a job (UAT rc.45 M1)", () => {
  const username = "wrapped-job-m1";
  const emptyName = "wrapped-job-m1-empty";
  let userId: string;
  let cookie: string;
  let emptyCookie: string;
  const budget = wrappedTiming.syncBudgetMs;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [username, emptyName] } } });
    userId = (
      await prisma.user.create({ data: { username, passwordHash: await hashPassword("pw123456") } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    const emptyId = (
      await prisma.user.create({
        data: { username: emptyName, passwordHash: await hashPassword("pw123456") },
      })
    ).id;
    emptyCookie = `auth_token=${generateToken(emptyId)}`;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "cruise"], data: {} },
    });
    await prisma.cruise.create({
      data: { userId, startDate: new Date("2024-05-10"), status: "completed" },
    });
  });

  afterEach(() => {
    wrappedTiming.syncBudgetMs = budget;
  });

  afterAll(async () => {
    await settleAllJobs();
    await prisma.user.deleteMany({ where: { username: { in: [username, emptyName] } } });
  });

  it("answers 202 with a job when the story outlasts the sync budget, and the job carries it", async () => {
    wrappedTiming.syncBudgetMs = 0;
    const res = await request(app).get("/api/v1/stats/wrapped").set("Cookie", cookie);
    expect(res.status).toBe(202);
    expect(typeof res.body.jobId).toBe("string");
    await settleAllJobs();
    const job = await request(app).get(`/api/v1/jobs/${res.body.jobId}`).set("Cookie", cookie);
    expect(job.status).toBe(200);
    expect(job.body.data.status).toBe("succeeded");
    expect(job.body.data.result).toMatchObject({ year: 2024, cruises: 1 });
  });

  it("a job for an account with no story fails as 'nothing to look back on' (404)", async () => {
    wrappedTiming.syncBudgetMs = 0;
    const res = await request(app).get("/api/v1/stats/wrapped").set("Cookie", emptyCookie);
    expect(res.status).toBe(202);
    await settleAllJobs();
    const job = await request(app).get(`/api/v1/jobs/${res.body.jobId}`).set("Cookie", emptyCookie);
    expect(job.body.data.status).toBe("failed");
    expect(job.body.data.error).toEqual({ code: "nothing_to_look_back_on", status: 404 });
  });

  it("still answers 200 directly when the story is quick", async () => {
    const res = await request(app).get("/api/v1/stats/wrapped").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ year: 2024 });
  });
});

describe("wrapped TravTrack cache (UAT rc.45 M1)", () => {
  const username = "wrapped-tt-cache-m1";
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    userId = (
      await prisma.user.create({ data: { username, passwordHash: await hashPassword("pw123456") } })
    ).id;
  });

  beforeEach(() => clearWrappedTravTrackCache());

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
  });

  it("computes once per fingerprint, and again when the fingerprint moves", async () => {
    const compute = jest.fn().mockResolvedValue({ km: 1 });
    await cachedTravTrackPart(userId, "year:2024", "fp1", compute);
    await cachedTravTrackPart(userId, "year:2024", "fp1", compute);
    expect(compute).toHaveBeenCalledTimes(1);
    await cachedTravTrackPart(userId, "year:2024", "fp2", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("two concurrent requests share one computation", async () => {
    let release!: (v: unknown) => void;
    const compute = jest.fn(() => new Promise((r) => (release = r)));
    const a = cachedTravTrackPart(userId, "year:2023", "fp", compute);
    const b = cachedTravTrackPart(userId, "year:2023", "fp", compute);
    release({ km: 2 });
    await expect(Promise.all([a, b])).resolves.toEqual([{ km: 2 }, { km: 2 }]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failure", async () => {
    const compute = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ km: 3 });
    await expect(cachedTravTrackPart(userId, "p", "fp", compute)).rejects.toThrow("boom");
    await expect(cachedTravTrackPart(userId, "p", "fp", compute)).resolves.toEqual({ km: 3 });
  });

  it("the fingerprint moves with a new point, a removal generation, a zone and a flight edit", async () => {
    const f0 = await travTrackFingerprint(userId, "UTC");
    await prisma.travTrackPoint.create({
      data: {
        userId,
        t: new Date("2024-03-01T10:00:00Z"),
        tS: 1709287200,
        lat: 50,
        lon: 8,
        origin: "companion:test",
        originRef: "r1",
      },
    });
    const f1 = await travTrackFingerprint(userId, "UTC");
    expect(f1).not.toBe(f0);
    await prisma.travTrackDerivationState.create({ data: { userId, historyGeneration: 1n } });
    const f2 = await travTrackFingerprint(userId, "UTC");
    expect(f2).not.toBe(f1);
    const flight = await prisma.flight.create({
      data: { userId, status: "flown", depLat: 50, depLon: 8, arrLat: 51, arrLon: 0 } as never,
    });
    const f3 = await travTrackFingerprint(userId, "UTC");
    expect(f3).not.toBe(f2);
    await prisma.flight.update({
      where: { id: flight.id },
      data: { updatedAt: new Date(Date.now() + 60_000) },
    });
    expect(await travTrackFingerprint(userId, "UTC")).not.toBe(f3);
    expect(await travTrackFingerprint(userId, "Europe/Berlin")).not.toBe(
      await travTrackFingerprint(userId, "UTC")
    );
  });
});
