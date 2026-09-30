import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { seedDemoInstance } from "../seedDemoAccount";
import { getInstanceSettings, updateInstanceSettings } from "../services/instanceSettingsService";
import { loadVisibleDomains } from "../services/domainVisibility";
import { generateToken } from "../utils/jwt";

/**
 * Owner, 2026-09-26: seeding the demo switches the instance's beta features
 * ON, so rail, roadtrips and tours show in the demo right away. It is the
 * instance switch the admin page writes — so on a real first install it is on
 * for the administrator too, which is the intent.
 *
 * The flag is restored afterwards: it is instance state every other suite in
 * this database reads.
 */
describe("seeding the demo account", () => {
  let before: boolean;
  let userId: string;

  beforeAll(async () => {
    before = (await getInstanceSettings()).betaFeaturesEnabled;
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    ({ userId } = await seedDemoInstance({ catalogues: false }));
  }, 180_000);

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: before });
    await prisma.user.deleteMany({ where: { username: "demo" } });
  });

  it("switches the instance's beta features on", async () => {
    expect((await getInstanceSettings()).betaFeaturesEnabled).toBe(true);
  });

  it("makes the gated domains visible to the demo user", async () => {
    const visible = await loadVisibleDomains(userId);
    expect(visible).toEqual(expect.arrayContaining(["rail", "roadtrip"]));
  });

  it("answers the demo user's settings and rail logbook as a visible, filled domain", async () => {
    const cookie = `auth_token=${generateToken(userId)}`;
    const settings = await request(app).get("/api/v1/settings").set("Cookie", cookie);
    expect(settings.status).toBe(200);
    expect(settings.body.betaFeaturesEnabled).toBe(true);
    expect(settings.body.enabledDomains).toEqual(expect.arrayContaining(["rail", "roadtrip"]));

    const rail = await request(app).get("/api/v1/rail").set("Cookie", cookie);
    expect(rail.status).toBe(200);
    expect(rail.body.meta.total).toBeGreaterThan(30);
  });

  it("leaves a flag an admin already switched on as it is, and says it changed nothing", async () => {
    const { enableBetaForDemo } = await import("../seedDemo/instance");
    expect(await enableBetaForDemo()).toBe(false);
  });
});
