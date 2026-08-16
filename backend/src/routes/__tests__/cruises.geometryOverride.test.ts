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
  let toPortId: number;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "geomovr" } });
    const u = await prisma.user.create({
      data: { username: "geomovr", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;

    const ports = await prisma.port.findMany({ where: { isUserAdded: false }, take: 2 });
    if (ports.length < 2) throw new Error("need two seeded ports — run the port seeder first");
    fromPortId = ports[0].id;
    toPortId = ports[1].id;

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
  });

  afterEach(async () => {
    await prisma.cruiseLegRoute.deleteMany({ where: { cruiseId } });
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const storeLine = async (): Promise<void> => {
    await prisma.cruiseLegRoute.create({
      data: {
        cruiseId,
        fromKind: "port",
        fromRef: String(fromPortId),
        toKind: "port",
        toRef: String(toPortId),
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
});
