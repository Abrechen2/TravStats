import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#435: the Yangtze cruise calls at two ports on day 2 and two on day 3.
 * `orderBy: { dayNumber }` left those ties to Postgres, so the server and the
 * dashboard could read Fengdu/Zhongxian in different orders and the map drew a
 * Zhongxian→Fengdu zig-zag of chords. The ids below sort the WRONG way round
 * (Zhongxian < Fengdu, Wushan < Fengjie) so an id-only tie-break fails here.
 */
describe("Cruise stops are read in one order: day, arrival time, id (forgejo#435)", () => {
  let authCookie: string;
  let userId: string;
  let cruiseId: string;
  let portIds: number[]; // Chongqing, Fengdu, Zhongxian, Fengjie, Wushan, Maoping, Yichang

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "stoporder435" } });
    const u = await prisma.user.create({
      data: { username: "stoporder435", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    authCookie = `auth_token=${generateToken(u.id)}`;
    const ports = await prisma.port.findMany({
      where: { isUserAdded: false },
      orderBy: { id: "asc" },
      take: 7,
    });
    if (ports.length < 7) throw new Error("need seven seeded ports — run the port seeder first");
    portIds = ports.map((p) => p.id);
    const at = (day: string, hhmm: string): Date => new Date(`2026-10-${day}T${hhmm}:00Z`);
    const stop = (id: string, port: number, dayNumber: number, a: Date, d: Date) => ({
      id,
      portId: port,
      dayNumber,
      isAtSea: false,
      arrivalTime: a,
      departureTime: d,
    });
    const c = await prisma.cruise.create({
      data: {
        userId,
        departurePortId: portIds[0],
        arrivalPortId: portIds[6],
        startDate: new Date("2026-10-01"),
        endDate: new Date("2026-10-05"),
        status: "completed",
        stops: {
          create: [
            // Inserted Zhongxian first, with the smaller id, on purpose.
            stop(
              "00000000-0000-4000-8000-000000000001",
              portIds[2],
              2,
              at("02", "15:00"),
              at("02", "17:00")
            ),
            stop(
              "ffffffff-0000-4000-8000-000000000001",
              portIds[1],
              2,
              at("02", "07:00"),
              at("02", "11:30")
            ),
            stop(
              "00000000-0000-4000-8000-000000000002",
              portIds[4],
              3,
              at("03", "14:00"),
              at("03", "17:00")
            ),
            stop(
              "ffffffff-0000-4000-8000-000000000002",
              portIds[3],
              3,
              at("03", "08:00"),
              at("03", "13:00")
            ),
            stop(
              "aaaaaaaa-0000-4000-8000-000000000003",
              portIds[5],
              4,
              at("04", "09:00"),
              at("04", "12:00")
            ),
          ],
        },
      },
    });
    cruiseId = c.id;
  });

  afterAll(async () => {
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const chain = (features: Array<{ properties: { fromPortId: number; toPortId: number } }>) => [
    features[0].properties.fromPortId,
    ...features.map((f) => f.properties.toPortId),
  ];

  it("routes the legs Chongqing→Fengdu→Zhongxian→Fengjie→Wushan→Maoping→Yichang", async () => {
    const res = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/geometry`)
      .set("Cookie", authCookie);
    expect(res.status).toBe(200);
    expect(chain(res.body.data.features)).toEqual(portIds);
  });

  it("answers the batch endpoint in the same order", async () => {
    const res = await request(app)
      .post("/api/v1/cruises/geometry/batch")
      .set("Cookie", authCookie)
      .send({ ids: [cruiseId] });
    expect(chain(res.body.data[cruiseId].features)).toEqual(portIds);
  });

  it("returns the stops of the cruise in that order too", async () => {
    const res = await request(app).get(`/api/v1/cruises/${cruiseId}`).set("Cookie", authCookie);
    const stops = (res.body.data ?? res.body).stops as Array<{ portId: number }>;
    expect(stops.map((s) => s.portId)).toEqual(portIds.slice(1, 6));
  });
});
