import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("Cruise route overrides", () => {
  let authCookie: string;
  let userId: string;
  let otherUserId: string;
  let cruiseId: string;
  let foreignCruiseId: string;
  let fromPortId: number;
  let toPortId: number;
  let fromPort: { lat: number; lon: number };
  let toPort: { lat: number; lon: number };

  // Anchored on purpose: the endpoints are the fixture's REAL port
  // coordinates, not arbitrary numbers — the PUT handler rejects a line
  // that doesn't start/end at its leg's ports (within 1 km), so any
  // waypoints used for a case that expects success have to be built from
  // whichever two ports the fixture actually picked up from the catalogue.
  const LINE = (): Array<[number, number]> => [
    [fromPort.lon, fromPort.lat],
    [(fromPort.lon + toPort.lon) / 2, (fromPort.lat + toPort.lat) / 2],
    [toPort.lon, toPort.lat],
  ];

  const key = (): Record<string, string> => ({
    fromKind: "port",
    fromRef: String(fromPortId),
    toKind: "port",
    toRef: String(toPortId),
  });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["routeovr", "routeovrother"] } } });

    const u = await prisma.user.create({
      data: { username: "routeovr", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const other = await prisma.user.create({
      data: { username: "routeovrother", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;

    const ports = await prisma.port.findMany({ where: { isUserAdded: false }, take: 2 });
    if (ports.length < 2) throw new Error("need two seeded ports — run the port seeder first");
    fromPortId = ports[0].id;
    toPortId = ports[1].id;
    fromPort = { lat: ports[0].lat, lon: ports[0].lon };
    toPort = { lat: ports[1].lat, lon: ports[1].lon };

    const c = await prisma.cruise.create({
      data: {
        userId,
        departurePortId: fromPortId,
        arrivalPortId: toPortId,
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-08"),
        status: "scheduled",
      },
    });
    cruiseId = c.id;

    // A REAL cruise owned by someone else. A made-up uuid would also 404 —
    // and would prove nothing about whether ownership is checked at all.
    const foreign = await prisma.cruise.create({
      data: {
        userId: otherUserId,
        departurePortId: fromPortId,
        arrivalPortId: toPortId,
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-08"),
        status: "scheduled",
      },
    });
    foreignCruiseId = foreign.id;
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("stores a line for a real leg", async () => {
    const res = await request(app)
      .put(`/api/v1/cruises/${cruiseId}/route-override`)
      .set("Cookie", authCookie)
      .send({ ...key(), waypoints: LINE() });
    expect(res.status).toBe(201);

    const rows = await prisma.cruiseLegRoute.findMany({ where: { cruiseId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].waypoints).toEqual(LINE());
  });

  it("replaces the line on a second write, leaving one row", async () => {
    const shorter: Array<[number, number]> = [
      [fromPort.lon, fromPort.lat],
      [toPort.lon, toPort.lat],
    ];
    const res = await request(app)
      .put(`/api/v1/cruises/${cruiseId}/route-override`)
      .set("Cookie", authCookie)
      .send({ ...key(), waypoints: shorter });
    expect(res.status).toBe(200);

    const rows = await prisma.cruiseLegRoute.findMany({ where: { cruiseId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].waypoints).toEqual(shorter);
  });

  it("refuses a leg that is not in the itinerary", async () => {
    const before = await prisma.cruiseLegRoute.count({ where: { cruiseId } });
    const res = await request(app)
      .put(`/api/v1/cruises/${cruiseId}/route-override`)
      .set("Cookie", authCookie)
      .send({ ...key(), fromRef: String(toPortId), toRef: String(fromPortId), waypoints: LINE() });
    expect(res.status).toBe(404);
    expect(await prisma.cruiseLegRoute.count({ where: { cruiseId } })).toBe(before);
  });

  it.each<[string, Array<[number, number]>]>([
    ["one waypoint", [[9.99, 53.55]]],
    [
      "a latitude of 91",
      [
        [9.99, 91],
        [-9.14, 38.72],
      ],
    ],
    ["65 waypoints", Array.from({ length: 65 }, (_, i) => [i / 10, 50])],
  ])("rejects %s", async (_label, waypoints) => {
    const res = await request(app)
      .put(`/api/v1/cruises/${cruiseId}/route-override`)
      .set("Cookie", authCookie)
      .send({ ...key(), waypoints });
    expect(res.status).toBe(400);
  });

  it("rejects a line whose first point is far from the departure port", async () => {
    const unanchored: Array<[number, number]> = [
      // Nowhere near fromPort — off by thousands of km.
      [fromPort.lon + 30, fromPort.lat + 10],
      [toPort.lon, toPort.lat],
    ];
    const res = await request(app)
      .put(`/api/v1/cruises/${cruiseId}/route-override`)
      .set("Cookie", authCookie)
      .send({ ...key(), waypoints: unanchored });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/departure port/i);
  });

  it("rejects a line whose last point is far from the arrival port", async () => {
    const unanchored: Array<[number, number]> = [
      [fromPort.lon, fromPort.lat],
      // Nowhere near toPort.
      [toPort.lon + 30, toPort.lat + 10],
    ];
    const res = await request(app)
      .put(`/api/v1/cruises/${cruiseId}/route-override`)
      .set("Cookie", authCookie)
      .send({ ...key(), waypoints: unanchored });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/arrival port/i);
  });

  it("will not write into another user's cruise", async () => {
    const res = await request(app)
      .put(`/api/v1/cruises/${foreignCruiseId}/route-override`)
      .set("Cookie", authCookie)
      .send({ ...key(), waypoints: LINE() });
    expect(res.status).toBe(404);
    expect(await prisma.cruiseLegRoute.count({ where: { cruiseId: foreignCruiseId } })).toBe(0);
  });

  it("rejects an unknown endpoint kind", async () => {
    const res = await request(app)
      .put(`/api/v1/cruises/${cruiseId}/route-override`)
      .set("Cookie", authCookie)
      .send({ ...key(), fromKind: "place", waypoints: LINE() });
    expect(res.status).toBe(400);
  });

  it("will not delete another user's override", async () => {
    const foreignRoute = await prisma.cruiseLegRoute.create({
      data: { cruiseId: foreignCruiseId, ...key(), waypoints: LINE() },
    });

    const res = await request(app)
      .delete(`/api/v1/cruises/${foreignCruiseId}/route-override`)
      .query(key())
      .set("Cookie", authCookie);
    expect(res.status).toBe(404);

    const stillThere = await prisma.cruiseLegRoute.findUnique({ where: { id: foreignRoute.id } });
    expect(stillThere).not.toBeNull();
  });

  it("clears the line, and clearing again is not an error", async () => {
    const first = await request(app)
      .delete(`/api/v1/cruises/${cruiseId}/route-override`)
      .query(key())
      .set("Cookie", authCookie);
    expect(first.status).toBe(200);
    expect(first.body.data.deleted).toBe(1);

    const second = await request(app)
      .delete(`/api/v1/cruises/${cruiseId}/route-override`)
      .query(key())
      .set("Cookie", authCookie);
    expect(second.status).toBe(200);
    expect(second.body.data.deleted).toBe(0);
  });
});
