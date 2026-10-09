import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { tourInsightsResponseSchema } from "../../schemas/statsInsights/tours";
import { assertSumInvariant } from "../../services/evidence/__tests__/invariants";
import type { EvidenceResponse } from "../../schemas/evidence";
import { checkAndUpdateAchievements } from "../../utils/achievements";
import { ensureAchievements } from "../../data/achievements";

/** forgejo#264 — the tour insights end to end: tab, evidence and badges agree. */
describe("GET /api/v1/stats/insights/tours", () => {
  const USER = "statsinsightstours";
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
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
    const activities = ["hike", "bike", "excursion"];
    for (const [i, activity] of activities.entries()) {
      const tour = await prisma.tripRoute.create({
        data: {
          userId,
          name: `Tour ${activity}`,
          mode: "foot",
          kind: "tour",
          activity,
          tourDate: d(`2024-0${i + 5}-01`),
        },
      });
      await prisma.tripStop.create({
        data: { title: "Start", lat: 47.27, lon: 11.4, routeId: tour.id, routeOrderIdx: 0 },
      });
      if (activity === "hike") {
        await prisma.tripRouteTrack.create({
          data: {
            routeId: tour.id,
            source: "gpx",
            startedAt: new Date("2024-05-01T08:00:00Z"),
            endedAt: new Date("2024-05-01T15:00:00Z"),
            geometry: [
              [11.4, 47.27],
              [11.41, 47.28],
            ],
            pointCount: 2,
            distanceKm: 14,
            ascentM: 1100,
            movingSeconds: 6 * 3600,
            elevations: [
              [0, 600],
              [7, 1700],
            ],
          },
        });
      }
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("answers a body the published schema accepts", async () => {
    const res = await request(app).get("/api/v1/stats/insights/tours").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const parsed = tourInsightsResponseSchema.safeParse(res.body);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect(res.body.all.completed).toBe(3);
    expect(res.body.all.pauseSeconds).toEqual({ total: 3600, tours: 1 });
    const hike = res.body.records.find((r: { activity: string }) => r.activity === "hike");
    expect(hike.highest.value).toBe(1700);
    expect(res.body.rhythm.firstAreas[0].country).toBe("AT");
  });

  it("lists the tours behind the climb, adding up to the tab", async () => {
    const res = await request(app).get("/api/v1/evidence/metric/tourAscentM").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const body = res.body as EvidenceResponse;
    expect(body.measure.value).toBe(1100);
    expect(body.entries[0].href).toMatch(/^\/tours\//);
    assertSumInvariant(body, Math.round);
  });

  it("holds the tour badges the data reaches", async () => {
    await checkAndUpdateAchievements(userId);
    const rows = await prisma.userAchievement.findMany({
      where: {
        userId,
        achievement: { code: { in: ["TOUR_FIRST_STEPS", "TOUR_THREE_KINDS", "TOUR_ASCENT_1000"] } },
      },
      include: { achievement: true },
    });
    const held = Object.fromEntries(rows.map((r) => [r.achievement.code, r.unlockedAt !== null]));
    expect(held).toEqual({
      TOUR_FIRST_STEPS: true,
      TOUR_THREE_KINDS: true,
      TOUR_ASCENT_1000: true,
    });
  });
});
