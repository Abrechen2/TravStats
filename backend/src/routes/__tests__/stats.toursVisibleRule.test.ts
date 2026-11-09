import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { ensureAchievements } from "../../data/achievements";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";

/**
 * Integration of the statistics branches. Day tours are a domain of their own
 * since 2026-11-09 (it replaced the coordinator ruling of 2026-10-09 "tours
 * follow the beta switch alone"): shown while the user has `tour` switched on
 * AND the instance's beta switch is open, and never by the roadtrip DOMAIN
 * toggle. With either off, the year in review and the tour badges drop them.
 */
describe("tours follow the tour domain and the beta switch, not the roadtrip toggle", () => {
  const username = "tours-visible-rule";
  let userId: string;
  let cookie: string;
  let betaBefore: boolean;

  beforeAll(async () => {
    await ensureAchievements();
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await prisma.user.deleteMany({ where: { username } });
    userId = (
      await prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    // Roadtrips switched OFF by the user, tours ON.
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "tour"], data: {} },
    });
    await prisma.tripRoute.create({
      data: {
        userId,
        name: "Hike",
        mode: "foot",
        kind: "tour",
        activity: "hike",
        tourDate: new Date("2024-05-01T00:00:00Z"),
      },
    });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { username } });
  });

  const wrapped = () => request(app).get("/api/v1/stats/wrapped").set("Cookie", cookie);
  const codes = async (): Promise<string[]> =>
    (await request(app).get("/api/v1/achievements").set("Cookie", cookie)).body.achievements.map(
      (a: { code: string }) => a.code
    );

  it("tells the tour chapter and lists the tour badges while tours are shown", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const res = await wrapped();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      year: 2024,
      chapters: { tours: { tours: 1 }, roadtrips: null },
    });
    const listed = await codes();
    expect(listed).toEqual(expect.arrayContaining(["TOUR_FIRST_STEPS", "TOUR_ASCENT_1000"]));
    // The roadtrip badges stay with the roadtrip domain.
    expect(listed).not.toContain("ROADTRIP_BASE_CAMP");
  });

  it("drops both when the user switched the tour domain off, beta open", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await prisma.userSettings.update({ where: { userId }, data: { enabledDomains: ["flight"] } });
    try {
      expect((await wrapped()).status).toBe(404);
      expect(await codes()).not.toContain("TOUR_FIRST_STEPS");
    } finally {
      await prisma.userSettings.update({
        where: { userId },
        data: { enabledDomains: ["flight", "tour"] },
      });
    }
  });

  it("drops both while the beta switch is off", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    expect((await wrapped()).status).toBe(404);
    expect(await codes()).not.toContain("TOUR_FIRST_STEPS");
  });
});
