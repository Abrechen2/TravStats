// Network-isolation strategy: force the stats-endpoint kill-switch instead of
// mocking `../../services/usageStats`. `getStatsBaseUrl()` (services/usageStats/consent.ts)
// reads `process.env.TRAVSTATS_STATS_ENDPOINT` fresh on every call rather than caching it
// at module-load time, so setting it to "" here is enough to guarantee
// `applyConsentChange("granted")` never fires `usageStatsTick()`'s network ping — see
// `services/usageStats/transport.ts` (`if (!baseUrl) return;`). This exercises the REAL
// route -> applyConsentChange -> setConsent wiring end to end (the actual coverage gap),
// rather than re-testing applyConsentChange's internals, which are already covered by
// mocked unit tests in `routes/adminUsageStats.test.ts`.
const ORIGINAL_STATS_ENDPOINT = process.env.TRAVSTATS_STATS_ENDPOINT;
process.env.TRAVSTATS_STATS_ENDPOINT = "";

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

describe("POST /api/v1/setup/initialize — usageStatsConsent", () => {
  let counter = 0;

  function uniqueUsername(): string {
    counter += 1;
    return `setup-usage-stats-${Date.now()}-${counter}`;
  }

  function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      username: uniqueUsername(),
      password: "password123",
      ...overrides,
    };
  }

  beforeEach(async () => {
    // adminCount === 0 is required for /setup/initialize to run at all, and a
    // clean AdminSettings singleton is required so no prior test's consent
    // value (or install id) leaks into the next assertion. AdminSettings is
    // re-created lazily by `ensureAdminSettings()` (both in
    // instanceSettingsService and services/usageStats/consent) whenever any
    // code path touches it, so deleting all rows here is safe.
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    await prisma.adminSettings.deleteMany();
  });

  afterAll(async () => {
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    await prisma.adminSettings.deleteMany();
    await prisma.$disconnect();
    if (ORIGINAL_STATS_ENDPOINT === undefined) {
      delete process.env.TRAVSTATS_STATS_ENDPOINT;
    } else {
      process.env.TRAVSTATS_STATS_ENDPOINT = ORIGINAL_STATS_ENDPOINT;
    }
  });

  it("defaults to unset consent and mints no install id when the field is omitted", async () => {
    const res = await request(app)
      .post("/api/v1/setup/initialize")
      .send(basePayload())
      .expect(200);

    expect(res.body.success).toBe(true);

    const row = await prisma.adminSettings.findFirst();
    expect(row).not.toBeNull();
    expect(row?.usageStatsConsent).toBe("unset");
    expect(row?.usageStatsInstallId).toBeNull();
  });

  it("persists 'granted' when usageStatsConsent is granted", async () => {
    const res = await request(app)
      .post("/api/v1/setup/initialize")
      .send(basePayload({ usageStatsConsent: "granted" }))
      .expect(200);

    expect(res.body.success).toBe(true);

    const row = await prisma.adminSettings.findFirst();
    expect(row?.usageStatsConsent).toBe("granted");
  });

  it("persists 'denied' when usageStatsConsent is denied", async () => {
    const res = await request(app)
      .post("/api/v1/setup/initialize")
      .send(basePayload({ usageStatsConsent: "denied" }))
      .expect(200);

    expect(res.body.success).toBe(true);

    const row = await prisma.adminSettings.findFirst();
    expect(row?.usageStatsConsent).toBe("denied");
  });

  it.each(["unset", "maybe"])(
    "rejects an invalid usageStatsConsent value (%s) and creates no admin user",
    async (invalidValue) => {
      await request(app)
        .post("/api/v1/setup/initialize")
        .send(basePayload({ usageStatsConsent: invalidValue }))
        .expect(400);

      const userCount = await prisma.user.count();
      expect(userCount).toBe(0);

      const adminCount = await prisma.user.count({ where: { isAdmin: true } });
      expect(adminCount).toBe(0);
    },
  );

  it("does not abort a valid install when a consent choice is present", async () => {
    const username = uniqueUsername();
    const res = await request(app)
      .post("/api/v1/setup/initialize")
      .send({ username, password: "password123", usageStatsConsent: "granted" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.user).toMatchObject({ username, isAdmin: true });
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(res.headers["set-cookie"][0]).toContain("auth_token");

    const user = await prisma.user.findUnique({ where: { username } });
    expect(user).not.toBeNull();
    expect(user?.isAdmin).toBe(true);

    const row = await prisma.adminSettings.findFirst();
    expect(row?.usageStatsConsent).toBe("granted");
  });
});
