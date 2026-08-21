import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

const LINE: Array<[number, number]> = [
  [9.99, 53.55],
  [2.5, 51.0],
  [-9.14, 38.72],
];

describe("Cruise geometry honours a stored route", () => {
  let authCookie: string;
  let userId: string;
  let cruiseId: string;
  let fromPortId: number;
  let midPortId: number;
  let toPortId: number;

  // Itinerary is departure(fromPortId) -> stop(midPortId) -> arrival(toPortId)
  // — two legs, so tests can prove an override attaches to ONE leg rather
  // than applying cruise-wide (indistinguishable with a single-leg fixture).
  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "geomovr" } });
    const u = await prisma.user.create({
      data: { username: "geomovr", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const ports = await prisma.port.findMany({ where: { isUserAdded: false }, take: 3 });
    if (ports.length < 3) throw new Error("need three seeded ports — run the port seeder first");
    fromPortId = ports[0].id;
    midPortId = ports[1].id;
    toPortId = ports[2].id;

    const c = await prisma.cruise.create({
      data: {
        userId,
        departurePortId: fromPortId,
        arrivalPortId: toPortId,
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-08"),
        status: "scheduled",
        stops: {
          create: [{ portId: midPortId, dayNumber: 3, isAtSea: false }],
        },
      },
    });
    cruiseId = c.id;
  });

  afterEach(async () => {
    await prisma.cruiseLegRoute.deleteMany({ where: { cruiseId } });
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // Defaults to leg 0 (from -> mid); pass explicit refs to target leg 1.
  const storeLine = async (
    fromRef: number = fromPortId,
    toRef: number = midPortId,
  ): Promise<void> => {
    await prisma.cruiseLegRoute.create({
      data: {
        cruiseId,
        fromKind: "port",
        fromRef: String(fromRef),
        toKind: "port",
        toRef: String(toRef),
        waypoints: LINE,
      },
    });
  };

  it("asks the router when nothing is stored", async () => {
    const res = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/geometry`)
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.features[0].properties.method).not.toBe("manual_polyline");
  });

  it("returns the stored line verbatim", async () => {
    await storeLine();
    const res = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/geometry`)
      .set("Cookie", authCookie);
    const f = res.body.data.features[0];
    // Deep equality on purpose: a length check would pass even if the
    // coordinates came back as [lat, lon].
    expect(f.geometry.coordinates).toEqual(LINE);
    expect(f.properties.method).toBe("manual_polyline");
    expect(f.properties.routed).toBe(false);
  });

  it("returns it from the batch endpoint too", async () => {
    await storeLine();
    const res = await request(app)
      .post("/api/v1/cruises/geometry/batch")
      .set("Cookie", authCookie)
      .send({ ids: [cruiseId] });
    expect(res.status).toBe(200);
    // The batch route has its own Prisma query. An override honoured by one
    // endpoint and not the other is exactly the drift this case exists for.
    expect(res.body.data[cruiseId].features[0].geometry.coordinates).toEqual(LINE);
    expect(res.body.data[cruiseId].features[0].properties.method).toBe("manual_polyline");
  });

  it("only the overridden leg's feature reflects the stored line", async () => {
    await storeLine(); // leg 0 only (from -> mid)
    const res = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/geometry`)
      .set("Cookie", authCookie);
    const [feature0, feature1] = res.body.data.features;

    expect(feature0.geometry.coordinates).toEqual(LINE);
    expect(feature0.properties.method).toBe("manual_polyline");

    expect(feature1.geometry.coordinates).not.toEqual(LINE);
    expect(feature1.properties.method).not.toBe("manual_polyline");
  });

  it("reverts to the router after DELETE, confirmed via the geometry endpoint", async () => {
    await storeLine();
    const before = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/geometry`)
      .set("Cookie", authCookie);
    expect(before.body.data.features[0].properties.method).toBe("manual_polyline");

    const del = await request(app)
      .delete(`/api/v1/cruises/${cruiseId}/route-override`)
      .query({ fromKind: "port", fromRef: String(fromPortId), toKind: "port", toRef: String(midPortId) })
      .set("Cookie", authCookie);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(1);

    const after = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/geometry`)
      .set("Cookie", authCookie);
    expect(after.status).toBe(200);
    expect(after.body.data.features[0].properties.method).not.toBe("manual_polyline");
  });
});
