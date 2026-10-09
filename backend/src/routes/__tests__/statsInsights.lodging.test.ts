import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { lodgingInsightsResponseSchema } from "../../schemas/statsInsights/lodging";
import { assertSumInvariant } from "../../services/evidence/__tests__/invariants";
import type { EvidenceResponse } from "../../schemas/evidence";
import { checkAndUpdateAchievements } from "../../utils/achievements";
import { ensureAchievements } from "../../data/achievements";

/**
 * forgejo#258 — the lodging insights endpoint, its evidence and its badges,
 * end to end against a real database: what the tab draws, what the panel
 * lists and what the badge measures are the same computation.
 */
describe("GET /api/v1/stats/insights/lodging", () => {
  const USER = "statsinsightslodging";
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await ensureAchievements();
    await prisma.user.deleteMany({ where: { username: USER } });
    const user = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;

    const business = await prisma.trip.create({
      data: { userId, name: "Messe", category: "business", endDate: new Date("2021-03-10") },
    });
    const home = await prisma.lodging.create({
      data: { userId, name: "Gasthof Linde", type: "guesthouse" },
    });
    // Five calendar years at one house, the first on a business trip that
    // starts on a Friday (2021-03-05): Fri + Sat are weekend nights.
    const years = [2021, 2022, 2023, 2024, 2025];
    for (const year of years) {
      await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: home.id,
          tripId: year === 2021 ? business.id : null,
          checkIn: new Date(year === 2021 ? "2021-03-05" : `${year}-06-02`),
          checkOut: new Date(year === 2021 ? "2021-03-08" : `${year}-06-03`),
          status: "completed",
        },
      });
    }
    // Ahead: counted nowhere.
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: home.id,
        checkIn: new Date("2030-01-01"),
        checkOut: new Date("2030-01-05"),
        status: "scheduled",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("answers a body the published schema accepts", async () => {
    const res = await request(app).get("/api/v1/stats/insights/lodging").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const parsed = lodgingInsightsResponseSchema.safeParse(res.body);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect(res.body.plannedStays).toBe(1);
    expect(res.body.revisits.sameHouseYearsMax).toBe(5);
    expect(res.body.weekRhythm.businessNights).toBe(3);
  });

  it("refuses an anonymous caller", async () => {
    const res = await request(app).get("/api/v1/stats/insights/lodging");
    expect(res.status).toBe(401);
  });

  it("lists the stays behind the weekend nights, adding up to the tile", async () => {
    const tab = await request(app).get("/api/v1/stats/insights/lodging").set("Cookie", cookie);
    const res = await request(app)
      .get("/api/v1/evidence/metric/lodgingWeekendNights")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const body = res.body as EvidenceResponse;
    expect(body.measure.value).toBe(tab.body.totals.lodgingWeekendNights.allTime);
    expect(body.measure.value).toBe(2 + 1 /* 2023-06-02 is a Friday */);
    assertSumInvariant(body, Math.round);

    const year = await request(app)
      .get("/api/v1/evidence/metric/lodgingBusinessNights?period=year&year=2021")
      .set("Cookie", cookie);
    expect(year.status).toBe(200);
    expect(year.body.measure.value).toBe(3);
  });

  it("refuses a year for a lifetime-only measure", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/lodgingReturnHouseCount?period=year&year=2024")
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("holds the five-years badge from the same measure", async () => {
    await checkAndUpdateAchievements(userId);
    const rows = await prisma.userAchievement.findMany({
      where: {
        userId,
        achievement: { code: { in: ["LODGING_WELCOME_YEARS_5", "LODGING_FULL_CALENDAR"] } },
      },
      include: { achievement: true },
    });
    const byCode = new Map(rows.map((r) => [r.achievement.code, r]));
    expect(byCode.get("LODGING_WELCOME_YEARS_5")?.progress).toBe(5);
    expect(byCode.get("LODGING_WELCOME_YEARS_5")?.unlockedAt).not.toBeNull();
    // One month a year — far from the calendar badge, which tracks progress only.
    expect(byCode.get("LODGING_FULL_CALENDAR")?.progress).toBe(1);
  });
});
