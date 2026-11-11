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
import { loadTripDistance } from "../../services/trip/tripDistance";
import { calculateInsightBadgeStats } from "../../utils/insightAchievements";
import { tourInsights } from "../../services/stats/insights";

/**
 * A day tour inside a trip is counted ONCE (tours-own-domain T3): in the year in review under
 * `tour`, in the tour statistics and the tour badges, and not again as a roadtrip chapter row or
 * as a roadtrip leg of the trip's distance. The roadtrip beside it keeps its own figures.
 */
describe("a tour inside a trip is counted once", () => {
  const username = "tour-in-trip-once";
  let userId: string;
  let tripId: string;
  let cookie: string;
  let betaBefore: boolean;

  beforeAll(async () => {
    await ensureAchievements();
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    await prisma.user.deleteMany({ where: { username } });
    userId = (
      await prisma.user.create({
        data: { username, passwordHash: await hashPassword("password123") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      data: { userId, enabledDomains: ["flight", "roadtrip", "tour"], data: {} },
    });
    tripId = (await prisma.trip.create({ data: { userId, name: "Norwegen" } })).id;
    const legged = async (kind: "roadtrip" | "tour", km: number, extra = {}) => {
      const route = await prisma.tripRoute.create({
        data: { userId, tripId, name: `${kind}-in-trip`, mode: "road", kind, ...extra },
      });
      const [a, b] = await Promise.all(
        [0, 1].map((i) =>
          prisma.tripStop.create({
            data: {
              title: `s${i}`,
              lat: 60 + i,
              lon: 10,
              routeId: route.id,
              routeOrderIdx: i,
              startDate: new Date("2024-05-01T00:00:00Z"),
            },
          })
        )
      );
      await prisma.tripRouteLeg.create({
        data: {
          routeId: route.id,
          fromStopId: a.id,
          toStopId: b.id,
          mode: "road",
          source: "straight",
          distanceKm: km,
        },
      });
      return route.id;
    };
    await legged("roadtrip", 100);
    await legged("tour", 12, { tourDate: new Date("2024-05-01T00:00:00Z"), activity: "hike" });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { username } });
  });

  it("year in review: one tour row and one roadtrip row, the tour's km in neither's total but its own", async () => {
    const res = await request(app).get("/api/v1/stats/wrapped").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.chapters.tours).toMatchObject({ tours: 1, km: 12 });
    expect(res.body.chapters.roadtrips).toMatchObject({ roadtrips: 1, km: 100 });
  });

  it("the trip's distance carries the roadtrip's road km and not the tour's", async () => {
    const d = await loadTripDistance(userId, tripId);
    expect(d.distanceByMode.roadtrip).toBe(100);
  });

  it("tour statistics and the tour badge measure see the tour once", async () => {
    const view = (await tourInsights(userId, new Date("2026-01-01T00:00:00Z"))).response;
    expect(view.all.completed).toBe(1);
    const stats = await calculateInsightBadgeStats(
      userId,
      { flights: [], cruises: [], userBirthday: null } as never,
      new Date("2026-01-01T00:00:00Z")
    );
    expect(stats.insightStats.tourCount).toBe(1);
  });

  it("the overview's tour list names it once and follows the tour gate", async () => {
    const counted = await request(app)
      .get("/api/v1/stats/insights/tours/counted")
      .set("Cookie", cookie);
    expect(counted.status).toBe(200);
    expect(counted.body.tours).toEqual([
      expect.objectContaining({ year: 2024, day: "2024-05-01", km: 12 }),
    ]);
    // Beta switch closed: no tour figure at all, not an empty list.
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    expect(
      (await request(app).get("/api/v1/stats/insights/tours/counted").set("Cookie", cookie)).status
    ).toBe(404);
    await updateInstanceSettings({ betaFeaturesEnabled: true });
  });
});
