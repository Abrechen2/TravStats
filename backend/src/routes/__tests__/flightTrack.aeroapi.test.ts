import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { flightDeviceDataLimiter } from "../../middleware/rateLimit";
import { flightTrackColumns } from "../../services/flightDevice/flightTrackIngest";

/**
 * A track the server fetched from FlightAware (`source: "aeroapi"`, forgejo#409)
 * fills a gap and yields: the passenger's own recording replaces it without
 * `replace`, while two recordings of the passenger's own still need it.
 */
const DEPARTURE = Date.parse("2026-10-03T08:00:00Z");
const points = (count: number, lat = 50) =>
  Array.from({ length: count }, (_, i) => ({
    t: DEPARTURE + i * 60_000,
    lat,
    lon: 8 + i * 0.2,
    alt: 10_000,
  }));

describe("Flight recordings over a FlightAware track", () => {
  let cookie: string;
  let userId: string;
  let flightId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "fltrackaero" } });
    const u = await prisma.user.create({
      data: { username: "fltrackaero", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await flightDeviceDataLimiter.resetKey(`user:${userId}`);
    await prisma.flight.deleteMany({ where: { userId } });
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
    const columns = flightTrackColumns(points(30, 51))!;
    await prisma.flightTrack.create({
      data: { ...columns, flightId, source: "aeroapi", uploadId: "aeroapi:fa-1" },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("is replaced by the phone's recording without asking for replace", async () => {
    const res = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send({ uploadId: "phone-1", points: points(40) });

    expect(res.status).toBe(201);
    const stored = await prisma.flightTrack.findUniqueOrThrow({ where: { flightId } });
    expect(stored.source).toBe("companion");
    expect(stored.uploadId).toBe("phone-1");
    expect(stored.pointCount).toBe(40);

    const second = await request(app)
      .post(`/api/v1/flights/${flightId}/track`)
      .set("Cookie", cookie)
      .send({ uploadId: "phone-2", points: points(5) });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("TRACK_ALREADY_RECORDED");
  });

  it("is replaced by an uploaded file without asking for replace", async () => {
    const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${points(
      20
    )
      .map(
        (p) =>
          `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.alt}</ele><time>${new Date(p.t).toISOString()}</time></trkpt>`
      )
      .join("")}</trkseg></trk></gpx>`;

    const res = await request(app)
      .post(`/api/v1/flights/${flightId}/track/file`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from(gpx), "flight.gpx");

    expect(res.status).toBe(201);
    expect((await prisma.flightTrack.findUniqueOrThrow({ where: { flightId } })).source).toBe(
      "gpx"
    );
  });
});
