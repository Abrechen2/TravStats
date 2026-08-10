import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * GET /flights/next — the single soonest upcoming flight for the dashboard
 * block. Ascending by departureTime, future-only, and NOT gated on the
 * `scheduled` status (a future flight stored as `flown` must still surface).
 */
describe("GET /flights/next", () => {
  let cookie: string;
  let userId: string;

  const HOUR = 3600_000;
  const mk = (offsetMs: number, extra: Record<string, unknown> = {}) => ({
    userId,
    depIata: "MUC",
    arrIata: "JFK",
    depLat: 48.35,
    depLon: 11.78,
    arrLat: 40.64,
    arrLon: -73.78,
    departureTime: new Date(Date.now() + offsetMs),
    arrivalTime: new Date(Date.now() + offsetMs + 9 * HOUR),
    status: "scheduled",
    ...extra,
  });

  beforeEach(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["nextFlightUser", "nextFlightOther"] } },
    });
    const user = await prisma.user.create({
      data: { username: "nextFlightUser", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "nextFlightUser" } });
  });

  it("returns null when there is nothing ahead", async () => {
    await prisma.flight.create({ data: mk(-48 * HOUR, { status: "flown" }) });
    const res = await request(app).get("/api/v1/flights/next").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.flight).toBeNull();
  });

  it("returns the soonest FUTURE flight, not a later one", async () => {
    await prisma.flight.create({ data: mk(30 * 24 * HOUR, { arrIata: "SIN" }) });
    await prisma.flight.create({ data: mk(3 * 24 * HOUR, { arrIata: "LHR" }) });
    const res = await request(app).get("/api/v1/flights/next").set("Cookie", cookie);
    expect(res.body.flight.arrIata).toBe("LHR");
    expect(res.body.flight.departure).toBeDefined();
    expect(res.body.flight.arrival).toBeDefined();
  });

  // The time is the source of truth, not the status: the nightly sweep only
  // reverts strictly-future rows to scheduled, so a future 'flown' must show.
  it("surfaces a future flight even if stored as flown", async () => {
    await prisma.flight.create({ data: mk(2 * 24 * HOUR, { status: "flown", arrIata: "CDG" }) });
    const res = await request(app).get("/api/v1/flights/next").set("Cookie", cookie);
    expect(res.body.flight.arrIata).toBe("CDG");
  });

  it("ignores a cancelled flight", async () => {
    await prisma.flight.create({ data: mk(1 * 24 * HOUR, { status: "cancelled", arrIata: "FRA" }) });
    await prisma.flight.create({ data: mk(5 * 24 * HOUR, { arrIata: "AMS" }) });
    const res = await request(app).get("/api/v1/flights/next").set("Cookie", cookie);
    expect(res.body.flight.arrIata).toBe("AMS");
  });

  it("does not leak another user's flight", async () => {
    const other = await prisma.user.create({
      data: { username: "nextFlightOther", passwordHash: await hashPassword("password123") },
    });
    await prisma.flight.create({
      data: { ...mk(1 * 24 * HOUR), userId: other.id, arrIata: "HND" },
    });
    const res = await request(app).get("/api/v1/flights/next").set("Cookie", cookie);
    expect(res.body.flight).toBeNull();
    await prisma.user.deleteMany({ where: { username: "nextFlightOther" } });
  });

  it("requires a session", async () => {
    expect((await request(app).get("/api/v1/flights/next")).status).toBe(401);
  });
});
