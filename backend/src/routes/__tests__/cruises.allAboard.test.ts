/**
 * forgejo#223: the "all aboard" time of a port call is a field of its own,
 * entered by the user from the ship's daily programme — stored as typed,
 * returned with the stop, never filled from the departure, and refused when it
 * is not a clock.
 */
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

const USER = "cruiseallaboard";

describe("a port call's all-aboard time", () => {
  let cookie: string;

  const cleanup = async (): Promise<void> => {
    await prisma.cruise.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const create = (stops: unknown[]) =>
    request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send({ cruiseLine: "Testreederei", startDate: "2026-07-01", stops });

  it("stores what the user typed and returns it with the stop", async () => {
    const res = await create([
      {
        dayNumber: 2,
        isAtSea: false,
        unresolvedPortName: "Hafen ohne Katalog",
        departureTime: { local: "2026-07-02T18:00" },
        allAboardTime: "17:30",
      },
      { dayNumber: 3, isAtSea: true },
    ]);
    expect(res.status).toBe(201);
    const stops = res.body.data.stops as Array<{ dayNumber: number; allAboardTime: unknown }>;
    expect(stops.find((s) => s.dayNumber === 2)?.allAboardTime).toBe("17:30");
    // Not derived: a stop without one says nothing, even with a departure.
    expect(stops.find((s) => s.dayNumber === 3)?.allAboardTime).toBeNull();
  });

  it("is not made up from the departure when none was entered", async () => {
    const res = await create([
      {
        dayNumber: 1,
        isAtSea: false,
        unresolvedPortName: "Hafen ohne Katalog",
        departureTime: { local: "2026-07-01T18:00" },
      },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data.stops[0].allAboardTime).toBeNull();
  });

  it("survives a PATCH that resends it, and an empty value clears it", async () => {
    const created = await create([
      { dayNumber: 1, isAtSea: false, unresolvedPortName: "Hafen", allAboardTime: "16:45" },
    ]);
    const id = created.body.data.id as string;

    const kept = await request(app)
      .patch(`/api/v1/cruises/${id}`)
      .set("Cookie", cookie)
      .send({
        stops: [
          { dayNumber: 1, isAtSea: false, unresolvedPortName: "Hafen", allAboardTime: "16:45" },
        ],
      });
    expect(kept.status).toBe(200);
    expect(kept.body.data.stops[0].allAboardTime).toBe("16:45");

    const cleared = await request(app)
      .patch(`/api/v1/cruises/${id}`)
      .set("Cookie", cookie)
      .send({
        stops: [{ dayNumber: 1, isAtSea: false, unresolvedPortName: "Hafen", allAboardTime: "" }],
      });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.stops[0].allAboardTime).toBeNull();
  });

  it.each(["25:00", "17:3", "5pm", "17:30:00"])("refuses %s", async (value) => {
    const res = await create([
      { dayNumber: 1, isAtSea: false, unresolvedPortName: "Hafen", allAboardTime: value },
    ]);
    expect(res.status).toBe(400);
  });
});
