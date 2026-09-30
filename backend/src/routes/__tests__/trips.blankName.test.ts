import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `z.string().min(1)` counted "   " as a name, so POST /trips {name: "   "}
 * answered 201 and the list grew a row with no name, and a PATCH could blank
 * an existing one. The schemas trim before counting now; this pins that the
 * HTTP answer is a 400 and that nothing was written.
 */
describe("a trip or tour name of only whitespace", () => {
  const USERNAME = "tripblankname";
  let authCookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
  });

  it("is refused on create, and no trip is written", async () => {
    await request(app)
      .post("/api/v1/trips")
      .set("Cookie", authCookie)
      .send({ name: "   " })
      .expect(400);
    expect(await prisma.trip.count({ where: { userId } })).toBe(0);
  });

  it("is refused on rename, and the stored name stays", async () => {
    const created = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", authCookie)
      .send({ name: "  Lissabon  " })
      .expect(201);
    expect(created.body.trip.name).toBe("Lissabon");

    await request(app)
      .patch(`/api/v1/trips/${created.body.trip.id}`)
      .set("Cookie", authCookie)
      .send({ name: "\t " })
      .expect(400);
    const stored = await prisma.trip.findUnique({ where: { id: created.body.trip.id } });
    expect(stored?.name).toBe("Lissabon");
  });

  it("is refused for a tour section on the trip", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "Norwegen" } });
    await request(app)
      .post(`/api/v1/trips/${trip.id}/routes`)
      .set("Cookie", authCookie)
      .send({ name: "  ", mode: "foot" })
      .expect(400);
    expect(await prisma.tripRoute.count({ where: { tripId: trip.id } })).toBe(0);
  });
});
