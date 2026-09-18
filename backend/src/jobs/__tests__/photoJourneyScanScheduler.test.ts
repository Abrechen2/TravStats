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
    expect(before.body.data).toEqual({ nightlyScan: false });

    const put = await request(app)
      .put("/api/v1/photo-journeys/settings")
      .set("Cookie", cookie)
      .send({ nightlyScan: true });
    expect(put.status).toBe(200);

    const after = await request(app).get("/api/v1/photo-journeys/settings").set("Cookie", cookie);
    expect(after.body.data).toEqual({ nightlyScan: true });

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
});
