import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `lat`, `lon` and `maxDistance` of /airports/coords/nearest went through
 * parseFloat unchecked: `maxDistance=20000` or a pole latitude loaded the whole
 * airport catalogue into memory, and `abc` slipped past (forgejo#380).
 */
describe("GET /airports/coords/nearest validates and bounds its query", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: {
        username: `nearest-${Date.now()}`,
        passwordHash: await hashPassword("pw-123456"),
        isActive: true,
      },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const get = (qs: string) =>
    request(app).get(`/api/v1/airports/coords/nearest?${qs}`).set("Cookie", cookie);

  it.each([
    "lat=abc&lon=8.5",
    "lat=50&lon=",
    "lat=91&lon=8",
    "lat=50&lon=181",
    "lat=50&lon=8&maxDistance=20000",
    "lat=50&lon=8&maxDistance=abc",
    "lat=50&lon=8&maxDistance=0",
  ])("rejects %s with 400", async (qs) => {
    const res = await get(qs);
    expect(res.status).toBe(400);
  });

  it("drops the longitude filter at a pole instead of an unbounded or truncated range", async () => {
    const spy = jest.spyOn(prisma.airport, "findMany");
    await get("lat=89.99&lon=100&maxDistance=500");
    const where = spy.mock.calls[0][0]!.where as { lat: { gte: number }; lon?: unknown };
    expect(where.lon).toBeUndefined();
    expect(where.lat.gte).toBeGreaterThan(80);
    spy.mockRestore();
  });

  it("still answers a sane query", async () => {
    const res = await get("lat=50.033&lon=8.570");
    expect([200, 404]).toContain(res.status);
  });
});
