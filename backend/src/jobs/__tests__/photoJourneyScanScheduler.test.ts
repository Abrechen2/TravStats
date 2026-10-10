import { describe, it, expect, jest, beforeAll, beforeEach, afterAll } from "@jest/globals";

const scanPhotoJourneys =
  jest.fn<(userId: string, options: { since: Date; until: Date }) => Promise<unknown>>();
jest.mock("../../services/photoJourneys/scan", () => ({
  scanPhotoJourneys: (userId: string, options: { since: Date; until: Date }) =>
    scanPhotoJourneys(userId, options),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { ImmichError } from "../../services/immich/types";
import { nextNightlyRunAt } from "../../services/photoJourneys/nightlySchedule";
import { hashPassword } from "../../utils/password";
import { NIGHTLY_WINDOW_DAYS, runPhotoJourneyNightlyScan } from "../photoJourneyScanScheduler";

/**
 * forgejo#94, point 5: the Foto-Spürhund runs every night — for the accounts
 * that turned it on, and only for those. What is pinned: the opt-in is off by
 * default and round-trips through its route; the nightly run scans exactly the
 * opted-in accounts over the last 400 days; one failing account does not stop
 * the rest.
 */
describe("nightly photo-journey scan", () => {
  const stamp = Date.now();
  let optedIn: string;
  let other: string;
  let broken: string;
  let cookie: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const user = (name: string) =>
      prisma.user.create({ data: { username: `pj-nightly-${name}-${stamp}`, passwordHash } });
    optedIn = (await user("in")).id;
    other = (await user("out")).id;
    broken = (await user("broken")).id;
    cookie = `auth_token=${generateToken(optedIn)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [optedIn, other, broken] } } });
  });

  beforeEach(() => {
    scanPhotoJourneys.mockReset();
  });

  it("is off until the account turns it on, through its own route", async () => {
    const before = await request(app).get("/api/v1/photo-journeys/settings").set("Cookie", cookie);
    expect(before.body.data).toMatchObject({ nightlyScan: false, lastRun: null, windowDays: 400 });

    const put = await request(app)
      .put("/api/v1/photo-journeys/settings")
      .set("Cookie", cookie)
      .send({ nightlyScan: true });
    expect(put.status).toBe(200);

    const after = await request(app).get("/api/v1/photo-journeys/settings").set("Cookie", cookie);
    expect(after.body.data).toMatchObject({ nightlyScan: true });

    const bad = await request(app)
      .put("/api/v1/photo-journeys/settings")
      .set("Cookie", cookie)
      .send({ nightlyScan: "yes" });
    expect(bad.status).toBe(400);
  });

  it("scans only opted-in accounts, over the last 400 days, and survives one failure", async () => {
    await prisma.userSettings.upsert({
      where: { userId: broken },
      update: { photoJourneyNightlyScan: true },
      create: { userId: broken, data: {}, photoJourneyNightlyScan: true },
    });
    scanPhotoJourneys.mockImplementation(async (userId) => {
      if (userId === broken) throw new Error("Immich unreachable");
      return { kind: "scanned", photosSeen: 10, truncated: false, created: 2, updated: 0 };
    });
    const now = new Date("2026-09-17T04:55:00Z");

    const result = await runPhotoJourneyNightlyScan(now);

    const scanned = scanPhotoJourneys.mock.calls.map(([userId]) => userId);
    expect(scanned).toContain(optedIn);
    expect(scanned).toContain(broken);
    expect(scanned).not.toContain(other);
    const [, options] = scanPhotoJourneys.mock.calls.find(([userId]) => userId === optedIn)!;
    expect(options.until).toEqual(now);
    expect(now.getTime() - options.since.getTime()).toBe(NIGHTLY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.created).toBeGreaterThanOrEqual(2);
  });

  it("records how each account's run ended, so its settings card can say so", async () => {
    await prisma.userSettings.upsert({
      where: { userId: optedIn },
      update: { photoJourneyNightlyScan: true },
      create: { userId: optedIn, data: {}, photoJourneyNightlyScan: true },
    });
    await prisma.userSettings.upsert({
      where: { userId: broken },
      update: { photoJourneyNightlyScan: true },
      create: { userId: broken, data: {}, photoJourneyNightlyScan: true },
    });
    scanPhotoJourneys.mockImplementation(async (userId) => {
      if (userId === broken) throw new ImmichError("unreachable", "connect ECONNREFUSED");
      return { kind: "scanned", photosSeen: 10, truncated: false, created: 3, updated: 1 };
    });
    const now = new Date("2026-09-18T04:55:00Z");
    await runPhotoJourneyNightlyScan(now);

    const ok = await request(app).get("/api/v1/photo-journeys/settings").set("Cookie", cookie);
    expect(ok.body.data.lastRun).toEqual({
      ranAt: now.toISOString(),
      result: "scanned",
      created: 3,
      failure: null,
    });
    const failed = await prisma.userSettings.findUniqueOrThrow({ where: { userId: broken } });
    expect(failed).toMatchObject({
      photoJourneyLastScanAt: now,
      photoJourneyLastScanResult: "failed",
      photoJourneyLastScanFailure: "unreachable",
      photoJourneyLastScanCreated: null,
    });

    // A non-Immich failure is ours, not the library's.
    scanPhotoJourneys.mockImplementation(async (userId) => {
      if (userId === broken) throw new Error("boom");
      return { kind: "no-immich" };
    });
    await runPhotoJourneyNightlyScan(now);
    const again = await request(app).get("/api/v1/photo-journeys/settings").set("Cookie", cookie);
    expect(again.body.data.lastRun).toMatchObject({ result: "noImmich", created: null });
    expect(
      (await prisma.userSettings.findUniqueOrThrow({ where: { userId: broken } }))
        .photoJourneyLastScanFailure
    ).toBe("internal");
  });

  it("names the next run: today's 04:55 UTC until it has passed, then tomorrow's", () => {
    expect(nextNightlyRunAt(new Date("2026-09-17T03:00:00Z")).toISOString()).toBe(
      "2026-09-17T04:55:00.000Z"
    );
    expect(nextNightlyRunAt(new Date("2026-09-17T04:55:00Z")).toISOString()).toBe(
      "2026-09-18T04:55:00.000Z"
    );
    expect(nextNightlyRunAt(new Date("2026-12-31T23:00:00Z")).toISOString()).toBe(
      "2027-01-01T04:55:00.000Z"
    );
  });

  it("answers the settings with what the card needs, and refuses the shared demo account", async () => {
    const res = await request(app).get("/api/v1/photo-journeys/settings").set("Cookie", cookie);
    expect(res.body.data).toMatchObject({
      immichConnected: false,
      windowDays: NIGHTLY_WINDOW_DAYS,
      nextRunAt: expect.stringMatching(/T04:55:00\.000Z$/),
    });

    await prisma.user.deleteMany({ where: { username: "demo" } });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: "x", isDemo: true },
    });
    try {
      const demoCookie = `auth_token=${generateToken(demo.id)}`;
      const put = await request(app)
        .put("/api/v1/photo-journeys/settings")
        .set("Cookie", demoCookie)
        .send({ nightlyScan: true });
      expect(put.status).toBe(403);
      expect(put.body.error).toBe("DEMO_ACCOUNT_FORBIDDEN");
      const read = await request(app)
        .get("/api/v1/photo-journeys/settings")
        .set("Cookie", demoCookie);
      expect(read.status).toBe(200);
      expect(read.body.data).toMatchObject({ nightlyScan: false, immichConnected: false });
    } finally {
      await prisma.user.delete({ where: { id: demo.id } });
    }
  });
});
