import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { roadtripInsightsResponseSchema } from "../../schemas/statsInsights/roadtrips";
import { assertSumInvariant } from "../../services/evidence/__tests__/invariants";
import type { EvidenceResponse } from "../../schemas/evidence";

/** forgejo#260 — the roadtrip insights end to end: tab and evidence agree. */
describe("GET /api/v1/stats/insights/roadtrips", () => {
  const USER = "statsinsightsroadtrips";
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    const user = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const trip = await prisma.tripRoute.create({
      data: { userId, name: "Dänemark", mode: "road", kind: "roadtrip" },
    });
    const a = await prisma.tripStop.create({
      data: {
        title: "Hamburg",
        lat: 53.55,
        lon: 9.99,
        startDate: d("2024-07-01"),
        routeId: trip.id,
        routeOrderIdx: 0,
      },
    });
    const b = await prisma.tripStop.create({
      data: {
        title: "Puttgarden",
        lat: 54.5,
        lon: 11.22,
        startDate: d("2024-07-01"),
        endDate: d("2024-07-02"),
        overnight: true,
        routeId: trip.id,
        routeOrderIdx: 1,
      },
    });
    const c = await prisma.tripStop.create({
      data: {
        title: "Rødby",
        lat: 54.65,
        lon: 11.35,
        startDate: d("2024-07-02"),
        routeId: trip.id,
        routeOrderIdx: 2,
      },
    });
    await prisma.tripRouteLeg.createMany({
      data: [
        {
          routeId: trip.id,
          fromStopId: a.id,
          toStopId: b.id,
          distanceKm: 150,
          source: "routed",
          mode: "road",
        },
        {
          routeId: trip.id,
          fromStopId: b.id,
          toStopId: c.id,
          distanceKm: 19,
          source: "straight",
          mode: "ferry",
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("answers a body the published schema accepts", async () => {
    const res = await request(app).get("/api/v1/stats/insights/roadtrips").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const parsed = roadtripInsightsResponseSchema.safeParse(res.body);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
    expect(res.body.roadtrips[0].kmByMode).toEqual({ road: 150, ferry: 19 });
    expect(res.body.roadtrips[0].nightsByStyle.pitch).toBe(1);
  });

  it("lists the roadtrips behind the ferry kilometres, adding up to the tile", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/roadtripFerryKm?period=year&year=2024")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    const body = res.body as EvidenceResponse;
    expect(body.measure.value).toBe(19);
    expect(body.entries[0].href).toMatch(/^\/roadtrips\//);
    assertSumInvariant(body, Math.round);
  });
});
