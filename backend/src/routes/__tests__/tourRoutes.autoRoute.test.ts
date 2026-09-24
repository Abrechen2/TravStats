jest.mock("../../services/tour/routing/resolveProvider", () => ({
  resolveRouteProvider: jest.fn(),
  describeRoutingAvailability: jest.fn(() => ({ configured: true, providerId: "custom" })),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { resolveRouteProvider } from "../../services/tour/routing/resolveProvider";
import type { RouteProvider, RouteRequest } from "../../services/tour/routing/types";

const mockResolveProvider = resolveRouteProvider as jest.Mock<Promise<RouteProvider | null>>;

/**
 * The way between two stations is a satnav route, not a straight line
 * (owner, 2026-09-24): a save routes the legs it CREATES through the
 * configured provider, on roadtrips and tours alike, and leaves every leg it
 * kept alone. The provider is a fake at the module boundary, so nothing here
 * reaches the network; `routeLegGeometry`'s own trust checks run for real.
 */
describe("Automatic routing of new legs on save", () => {
  let cookie: string;
  let userId: string;

  const HAMBURG = { title: "Hamburg", lat: 53.55, lon: 9.99 };
  const AALBORG = { title: "Aalborg", lat: 57.05, lon: 9.92 };
  const STAVANGER = { title: "Stavanger", lat: 58.97, lon: 5.73 };

  /** Answers every request with a bent line anchored at the leg's own ends. */
  const bentRoad = jest.fn(async ({ from, to }: RouteRequest) => ({
    waypoints: [
      [from.lon, from.lat],
      [(from.lon + to.lon) / 2 + 0.2, (from.lat + to.lat) / 2],
      [to.lon, to.lat],
    ] as Array<[number, number]>,
    distanceKm: 500,
    drivingMinutes: 330,
  }));

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourautoroute" } });
    const u = await prisma.user.create({
      data: { username: "tourautoroute", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveProvider.mockResolvedValue({ id: "custom", route: bentRoad });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourautoroute" } });
    await prisma.$disconnect();
  });

  const station = (s: typeof HAMBURG, id?: string) => ({
    ...(id ? { id } : {}),
    title: s.title,
    lat: s.lat,
    lon: s.lon,
    night: { kind: "pass" },
  });

  async function newRoadtrip(): Promise<string> {
    const res = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Nordkap", vehicle: "motorhome" });
    return res.body.roadtrip.id as string;
  }

  it("routes the legs of a roadtrip's first save along the road", async () => {
    const id = await newRoadtrip();
    const res = await request(app)
      .put(`/api/v1/roadtrips/${id}/stations`)
      .set("Cookie", cookie)
      .send({ stations: [station(HAMBURG), station(AALBORG), station(STAVANGER)] });

    expect(res.status).toBe(200);
    expect(bentRoad).toHaveBeenCalledTimes(2);
    expect(res.body.legs).toHaveLength(2);
    for (const leg of res.body.legs) {
      expect(leg.source).toBe("routed");
      expect(leg.distanceKm).toBe(500);
      expect(leg.waypoints).toHaveLength(3);
    }
  });

  it("routes only the leg a later save adds, and keeps a leg set back to straight", async () => {
    const id = await newRoadtrip();
    const first = await request(app)
      .put(`/api/v1/roadtrips/${id}/stations`)
      .set("Cookie", cookie)
      .send({ stations: [station(HAMBURG), station(AALBORG)] });
    const [hamburg, aalborg] = first.body.stations as Array<{ id: string }>;

    // The user decides this one stays a straight line.
    await prisma.tripRouteLeg.updateMany({
      where: { routeId: id },
      data: { source: "straight", distanceKm: 389 },
    });
    bentRoad.mockClear();

    const res = await request(app)
      .put(`/api/v1/roadtrips/${id}/stations`)
      .set("Cookie", cookie)
      .send({
        stations: [station(HAMBURG, hamburg.id), station(AALBORG, aalborg.id), station(STAVANGER)],
      });

    expect(res.status).toBe(200);
    expect(bentRoad).toHaveBeenCalledTimes(1);
    const [kept, added] = res.body.legs;
    expect(kept).toMatchObject({ source: "straight", distanceKm: 389 });
    expect(added).toMatchObject({ source: "routed", distanceKm: 500 });
  });

  it("routes the path of a standalone day tour on foot", async () => {
    const tour = await request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name: "Preikestolen", mode: "foot", activity: "hike" });
    const routeId = tour.body.route.id as string;

    const res = await request(app)
      .put(`/api/v1/tours/${routeId}/points`)
      .set("Cookie", cookie)
      .send({
        points: [
          { title: "Parkplatz", lat: 58.9868, lon: 6.1903 },
          { title: "Preikestolen", lat: 58.9864, lon: 6.1874 },
        ],
      });

    expect(res.status).toBe(200);
    expect(bentRoad).toHaveBeenCalledWith(expect.objectContaining({ mode: "foot" }));
    expect(res.body.legs[0].source).toBe("routed");
  });

  it("saves the straight line when the provider fails, and never fails the save", async () => {
    mockResolveProvider.mockResolvedValue({
      id: "custom",
      route: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    const id = await newRoadtrip();
    const res = await request(app)
      .put(`/api/v1/roadtrips/${id}/stations`)
      .set("Cookie", cookie)
      .send({ stations: [station(HAMBURG), station(AALBORG)] });

    expect(res.status).toBe(200);
    expect(res.body.legs[0].source).toBe("straight");
  });

  it("does nothing without a provider", async () => {
    mockResolveProvider.mockResolvedValue(null);
    const id = await newRoadtrip();
    const res = await request(app)
      .put(`/api/v1/roadtrips/${id}/stations`)
      .set("Cookie", cookie)
      .send({ stations: [station(HAMBURG), station(AALBORG)] });

    expect(res.status).toBe(200);
    expect(res.body.legs[0].source).toBe("straight");
  });
});
