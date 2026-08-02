import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * A hand-made trip has no linked flights or cruises, so the segment-based
 * status derivation returns null and the write fell through to the column
 * default — which was "completed". Every trip was therefore born finished,
 * including one starting next week, while the start and end dates the user
 * had just typed were never consulted. Derive from the trip's own bounds
 * when there are no segments.
 */
describe("POST /api/v1/trips status derivation", () => {
  let authCookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripstatuscreate" } });
    const user = await prisma.user.create({
      data: { username: "tripstatuscreate", passwordHash: await hashPassword("password123") },
    });
    authCookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripstatuscreate" } });
  });

  const create = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/trips").set("Cookie", authCookie).send(body).expect(201);

  const inDays = (days: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
  };

  it("calls a trip that has not started yet planned, not completed", async () => {
    const res = await create({
      name: "Future trip",
      startDate: inDays(8),
      endDate: inDays(18),
    });
    expect(res.body.trip.status).toBe("planned");
  });

  it("calls a trip whose dates have passed completed", async () => {
    const res = await create({
      name: "Past trip",
      startDate: inDays(-30),
      endDate: inDays(-20),
    });
    expect(res.body.trip.status).toBe("completed");
  });

  it("calls a trip spanning today in_progress", async () => {
    const res = await create({
      name: "Running trip",
      startDate: inDays(-2),
      endDate: inDays(2),
    });
    expect(res.body.trip.status).toBe("in_progress");
  });

  it("keeps an explicit status from the client", async () => {
    const res = await create({
      name: "Explicit",
      startDate: inDays(8),
      endDate: inDays(18),
      status: "completed",
    });
    expect(res.body.trip.status).toBe("completed");
  });

  it("falls back to planned when the trip carries no dates at all", async () => {
    const res = await create({ name: "Dateless" });
    expect(res.body.trip.status).toBe("planned");
  });
});
