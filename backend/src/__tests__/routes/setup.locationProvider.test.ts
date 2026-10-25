import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";

/**
 * The first admin of a fresh instance (TravTrack plan T8): `setup.ts` asks
 * `initialLocationProvider` like every other creation path. A fresh install
 * has the beta switch off, so TravTrack is off and the admin starts on `none`.
 * Wipes users like `setup.usageStats.test.ts` — `/setup/initialize` runs only
 * while no admin exists.
 */
describe("POST /api/v1/setup/initialize — the location provider", () => {
  const ORIGINAL_STATS_ENDPOINT = process.env.TRAVSTATS_STATS_ENDPOINT;

  beforeAll(() => {
    process.env.TRAVSTATS_STATS_ENDPOINT = "";
  });

  beforeEach(async () => {
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    await prisma.adminSettings.deleteMany();
    await prisma.travTrackConfig.deleteMany();
  });

  afterAll(async () => {
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    await prisma.adminSettings.deleteMany();
    await prisma.$disconnect();
    if (ORIGINAL_STATS_ENDPOINT === undefined) delete process.env.TRAVSTATS_STATS_ENDPOINT;
    else process.env.TRAVSTATS_STATS_ENDPOINT = ORIGINAL_STATS_ENDPOINT;
  });

  it("the first admin of a fresh instance starts on none (TravTrack is off on a fresh install)", async () => {
    await request(app)
      .post("/api/v1/setup/initialize")
      .send({ username: "setup-location-admin", password: "password123" })
      .expect(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { username: "setup-location-admin" },
    });
    const settings = await prisma.userSettings.findUnique({
      where: { userId: user.id },
      select: { locationProvider: true, data: true },
    });
    expect(settings?.locationProvider ?? "none").toBe("none");
    expect(settings?.data).toHaveProperty("whatsNewSeenVersion");
  });
});
