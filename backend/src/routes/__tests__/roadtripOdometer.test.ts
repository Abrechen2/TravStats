import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#280 point 1: a roadtrip's end odometer below its start one is
 * refused with a stable field error, also when only one reading is patched
 * against the stored other. Every value is invented.
 */
describe("roadtrip odometer order (forgejo#280)", () => {
  const USER = "roadtrip-odometer-user";
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  const create = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/roadtrips").set("Cookie", cookie).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/tours/${id}`).set("Cookie", cookie).send(body);

  it("refuses a roadtrip created with the end below the start", async () => {
    const res = await create({ name: "R", startOdometerKm: 10_000, endOdometerKm: 9_000 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "TOUR_ODOMETER_REVERSED", field: "endOdometerKm" });
  });

  it("accepts end equal to start and a single reading", async () => {
    expect((await create({ name: "A", startOdometerKm: 5, endOdometerKm: 5 })).status).toBe(201);
    expect((await create({ name: "B", endOdometerKm: 5 })).status).toBe(201);
  });

  it("holds a patched reading against the stored other, and lets a clear through", async () => {
    const made = await create({ name: "C", startOdometerKm: 10_000, endOdometerKm: 10_300 });
    const id = made.body.roadtrip.id as string;
    const bad = await patch(id, { endOdometerKm: 9_999 });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ code: "TOUR_ODOMETER_REVERSED" });
    const bad2 = await patch(id, { startOdometerKm: 10_301 });
    expect(bad2.status).toBe(400);
    expect((await patch(id, { endOdometerKm: null })).status).toBe(200);
    expect((await patch(id, { startOdometerKm: 20_000 })).status).toBe(200);
  });
});
