import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { placeInsightsResponseSchema } from "../../schemas/statsInsights/places";
import { assertSumInvariant } from "../../services/evidence/__tests__/invariants";
import type { EvidenceResponse } from "../../schemas/evidence";
import { checkAndUpdateAchievements } from "../../utils/achievements";
import { ensureAchievements } from "../../data/achievements";

/** forgejo#259 — the places insights end to end: tab, evidence and badges agree. */
describe("GET /api/v1/stats/insights/places", () => {
  const USER = "statsinsightsplaces";
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

    const trip = await prisma.trip.create({ data: { userId, name: "Rom" } });
    const categories = ["sight", "food", "museum", "nature", "shopping"];
    for (const [i, category] of categories.entries()) {
      const place = await prisma.place.create({
        data: { userId, name: `Ort ${i}`, category, lat: 41.9 + i / 100, lon: 12.5, visited: true },
      });
      await prisma.placeVisit.create({
        data: {
          userId,
          placeId: place.id,
          tripId: trip.id,
          visitedAt: new Date(`2018-05-0${i + 1}T10:00:00Z`),
          notes: i === 0 ? "Notiz" : null,
        },
      });
    }
    // The first place again, six years on: a return after more than five years.
    const first = await prisma.place.findFirstOrThrow({ where: { userId, name: "Ort 0" } });
    await prisma.placeVisit.create({
      data: { userId, placeId: first.id, visitedAt: new Date("2024-06-01T10:00:00Z"), rating: 5 },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("answers a body the published schema accepts", async () => {
    const res = await request(app).get("/api/v1/stats/insights/places").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const parsed = placeInsightsResponseSchema.safeParse(res.body);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect(res.body.diversity.tripCategoriesMax).toBe(5);
    expect(res.body.revisits.longestGapYears).toBe(6);
  });

  it("lists discoveries and returns that add up to the tab's figures", async () => {
    const tab = await request(app).get("/api/v1/stats/insights/places").set("Cookie", cookie);
    for (const key of ["placeDiscoveryVisits", "placeRevisitVisits", "placeVisitsWithNote"]) {
      const res = await request(app).get(`/api/v1/evidence/metric/${key}`).set("Cookie", cookie);
      expect([key, res.status]).toEqual([key, 200]);
      const body = res.body as EvidenceResponse;
      expect(body.measure.value).toBe(tab.body.totals[key].allTime);
      assertSumInvariant(body, Math.round);
    }
    const year = await request(app)
      .get("/api/v1/evidence/metric/placeRevisitVisits?period=year&year=2024")
      .set("Cookie", cookie);
    expect(year.body.measure.value).toBe(1);
    expect(year.body.entries[0].href).toMatch(/^\/places\//);
  });

  it("holds the two badges the data reaches, and not the one it does not", async () => {
    await checkAndUpdateAchievements(userId);
    const rows = await prisma.userAchievement.findMany({
      where: {
        userId,
        achievement: {
          code: { in: ["PLACE_REUNION_5Y", "PLACE_COLOURFUL_TRIP", "PLACE_WELL_REMEMBERED_10"] },
        },
      },
      include: { achievement: true },
    });
    const held = Object.fromEntries(rows.map((r) => [r.achievement.code, r.unlockedAt !== null]));
    // No visit carries both a note and a photo, so "Gut erinnert" has nothing to track.
    expect(held).toEqual({ PLACE_REUNION_5Y: true, PLACE_COLOURFUL_TRIP: true });
  });
});
