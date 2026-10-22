import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * "Live-Verfolgung" (forgejo#321): with the account's live tracking off, the
 * phone's recording of a flight is refused and nothing is stored — the server
 * holds the switch, so a Companion that has not read it yet still cannot
 * store a position the user said not to take. What is stored stays readable.
 */
const DEPARTURE = Date.parse("2026-10-03T08:00:00Z");
const points = Array.from({ length: 20 }, (_, i) => ({
  t: DEPARTURE + i * 60_000,
  lat: 50,
  lon: 8 + i * 0.2,
  alt: 10_000,
  speed: 240,
}));

describe("flight recording — live tracking switch", () => {
  const username = `live-tracking-${Date.now()}`;
  let cookie: string;
  let userId: string;
  let flightId: string;

  const setLive = (enabled: boolean) =>
    request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ liveTracking: { enabled } })
      .expect(200);
  const upload = (uploadId: string) =>
    request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send({ uploadId, points });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    flightId = (
      await prisma.flight.create({
        data: {
          userId,
          depIata: "MUC",
          arrIata: "ICN",
          depLat: 48.354,
          depLon: 11.786,
          arrLat: 37.469,
          arrLon: 126.451,
          flightNumber: "LH718",
          departureTime: new Date(DEPARTURE),
          arrivalTime: new Date(DEPARTURE + 11 * 3_600_000),
          status: "flown",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  it("off: refuses the upload with 409 FLIGHT_TRACKING_DISABLED and stores nothing", async () => {
    await setLive(false);
    const res = await upload("live-off-1");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("FLIGHT_TRACKING_DISABLED");
    expect(await prisma.flightTrack.count({ where: { flightId } })).toBe(0);
  });

  it("on (the default) stores it, and switching off later keeps what is stored", async () => {
    expect((await upload("live-on-1")).status).toBe(201);
    await setLive(false);
    const read = await request(app).get(`/api/v1/flights/${flightId}/track`).set("Cookie", cookie);
    expect(read.status).toBe(200);
    expect(read.body.track).not.toBeNull();
  });

  it("another account's flight still answers 404, not the switch", async () => {
    await setLive(false);
    const other = await prisma.user.create({
      data: { username: `${username}-o`, passwordHash: await hashPassword("password123") },
    });
    try {
      const res = await request(app)
        .post(`/api/v1/flights/${flightId}/track`)
        .set("Cookie", `auth_token=${generateToken(other.id)}`)
        .send({ uploadId: "x", points });
      expect(res.status).toBe(404);
    } finally {
      await prisma.user.delete({ where: { id: other.id } });
    }
  });
});
