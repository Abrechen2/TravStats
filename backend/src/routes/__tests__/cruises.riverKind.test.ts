import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * #359: river ships live in the catalogue, a cruise carries ocean/river, and a
 * cruise on a river ship is a river cruise unless the user says otherwise.
 */
describe("river cruises (#359)", () => {
  let userId: string;
  let cookie: string;
  const shipName = `Nile Test Ship ${Date.now()}`;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "rivercruiser" } });
    const user = await prisma.user.create({
      data: { username: "rivercruiser", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.ship.deleteMany({ where: { name: shipName } });
  });

  it("adds a user ship flagged river and finds it under kind=river only", async () => {
    const created = await request(app)
      .post("/api/v1/ships")
      .set("Cookie", cookie)
      .send({ name: shipName, cruiseLine: "Nile Test Line", kind: "river" });
    expect(created.status).toBe(201);
    expect(created.body.data.kind).toBe("river");

    const river = await request(app)
      .get(`/api/v1/ships?q=${encodeURIComponent(shipName)}&kind=river`)
      .set("Cookie", cookie);
    expect(river.body.data.map((s: { name: string }) => s.name)).toContain(shipName);
    const ocean = await request(app)
      .get(`/api/v1/ships?q=${encodeURIComponent(shipName)}&kind=ocean`)
      .set("Cookie", cookie);
    expect(ocean.body.data).toHaveLength(0);
  });

  it("refuses an unknown ship kind", async () => {
    const res = await request(app)
      .post("/api/v1/ships")
      .set("Cookie", cookie)
      .send({ name: `${shipName} X`, cruiseLine: "Nile Test Line", kind: "submarine" });
    expect(res.status).toBe(400);
  });

  it("makes a cruise on a river ship a river cruise, and honours an explicit kind", async () => {
    const ship = await prisma.ship.findFirstOrThrow({ where: { name: shipName } });
    const inherited = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send({ shipId: ship.id, startDate: "2025-02-01", endDate: "2025-02-05" });
    expect(inherited.status).toBe(201);
    expect(inherited.body.data.kind).toBe("river");

    const explicit = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send({ shipId: ship.id, startDate: "2025-03-01", endDate: "2025-03-05", kind: "ocean" });
    expect(explicit.body.data.kind).toBe("ocean");

    const plain = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send({ cruiseLine: "Plain Line", startDate: "2025-04-01", endDate: "2025-04-05" });
    expect(plain.body.data.kind).toBe("ocean");

    const patched = await request(app)
      .patch(`/api/v1/cruises/${plain.body.data.id}`)
      .set("Cookie", cookie)
      .send({ kind: "river" });
    expect(patched.status).toBe(200);
    expect(patched.body.data.kind).toBe("river");
  });

  it("counts river cruises apart on the statistics tab", async () => {
    const res = await request(app).get("/api/v1/stats/cruise").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.riverCruisesCount).toBe(2);
    expect(res.body.cruisesCount).toBe(3);
  });
});
