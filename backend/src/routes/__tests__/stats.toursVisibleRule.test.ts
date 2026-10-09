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
 * Integration of the statistics branches (coordinator ruling 2026-10-09): day
 * tours are shown by ONE rule, the web's `useToursVisible` — the instance's
 * beta switch — and never by the roadtrip DOMAIN toggle. A user who switched
 * roadtrips off still sees their tours on the tours page, so the year in
 * review counts them and the tour badges are listed; with the switch off,
 * neither is.
 */
describe("tours follow the beta switch, not the roadtrip toggle", () => {
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
    // Roadtrips switched OFF by the user.
    await prisma.userSettings.create({ data: { userId, enabledDomains: ["flight"], data: {} } });
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

  it("drops both while the switch is off", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    expect((await wrapped()).status).toBe(404);
    expect(await codes()).not.toContain("TOUR_FIRST_STEPS");
  });
});
