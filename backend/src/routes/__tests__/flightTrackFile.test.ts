import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { FILE_LIMITS } from "../../config/constants";

/**
 * A recorded flight track uploaded as a FILE (forgejo#312): GPX or KML from a
 * logger or a flight tracker's export, stored in the same one-per-flight
 * `FlightTrack` row the Companion writes, and refused with a stable reason
 * when it cannot be used.
 *
 * The line runs due east along 50°N from 08:00Z, one point a minute, 0.2°
 * (~14 km) per step.
 */

const DEPARTURE = Date.parse("2026-10-03T08:00:00Z");

function positions(count: number, from = DEPARTURE) {
  return Array.from({ length: count }, (_, i) => ({
    t: new Date(from + i * 60_000).toISOString(),
    lat: 50,
    lon: Number((8 + i * 0.2).toFixed(4)),
    alt: 10_000 + i,
  }));
}

function gpx(count: number, from = DEPARTURE): Buffer {
  const pts = positions(count, from)
    .map(
      (p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.alt}</ele><time>${p.t}</time></trkpt>`
    )
    .join("");
  return Buffer.from(
    `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><name>LH718</name><trkseg>${pts}</trkseg></trk></gpx>`
  );
}

function kmlTrack(count: number): Buffer {
  const ps = positions(count);
  return Buffer.from(
    `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">` +
      `<Document><Placemark><name>DLH718</name><gx:Track>` +
      ps.map((p) => `<when>${p.t}</when>`).join("") +
      ps.map((p) => `<gx:coord>${p.lon} ${p.lat} ${p.alt}</gx:coord>`).join("") +
      `</gx:Track></Placemark></Document></kml>`
  );
}

function kmlLine(count: number): Buffer {
  const coords = positions(count)
    .map((p) => `${p.lon},${p.lat}`)
    .join(" ");
  return Buffer.from(
    `<kml><Placemark><LineString><coordinates>${coords}</coordinates></LineString></Placemark></kml>`
  );
}

describe("Flight track file upload — POST /flights/:id/track/file", () => {
  let cookie: string;
  let userId: string;
  let otherUserId: string;
  let flightId: string;
  let otherFlightId: string;
  let unscheduledFlightId: string;

  const upload = (id: string, file: Buffer, name: string, replace?: boolean) => {
    const req = request(app).post(`/api/v1/flights/${id}/track/file`).set("Cookie", cookie);
    if (replace !== undefined) req.field("replace", String(replace));
    return req.attach("file", file, name);
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["fltfile", "fltfileother"] } } });
    const u = await prisma.user.create({
      data: { username: "fltfile", passwordHash: await hashPassword("password123") },
    });
    const o = await prisma.user.create({
      data: { username: "fltfileother", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    otherUserId = o.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    const base = {
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
    };
    flightId = (await prisma.flight.create({ data: { ...base, userId } })).id;
    otherFlightId = (await prisma.flight.create({ data: { ...base, userId: otherUserId } })).id;
    unscheduledFlightId = (
      await prisma.flight.create({
        data: { ...base, userId, departureTime: null, arrivalTime: null, status: "historical" },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("stores a GPX recording as the flight's track and serves its line", async () => {
    const res = await upload(flightId, gpx(60), "LH718.gpx");
    expect(res.status).toBe(201);
    expect(res.body.replayed).toBe(false);
    expect(res.body.track).toMatchObject({ flightId, source: "gpx", pointCount: 60 });

    const get = await request(app).get(`/api/v1/flights/${flightId}/track`).set("Cookie", cookie);
    expect(get.body.track.geometry[0]).toEqual([8, 50]);
    expect(get.body.track.times.startedAt.utc).toBe("2026-10-03T08:00:00.000Z");
    expect(get.body.track.elevations).not.toBeNull();
    expect(get.body.track.distanceKm).toBeGreaterThan(820);
    expect(get.body.track.distanceKm).toBeLessThan(870);
  });

  it("stores a KML gx:Track with its altitudes", async () => {
    const res = await upload(flightId, kmlTrack(30), "export.kml");
    expect(res.status).toBe(201);
    expect(res.body.track).toMatchObject({ source: "kml", pointCount: 30 });
    const stored = await prisma.flightTrack.findUniqueOrThrow({ where: { flightId } });
    expect(stored.elevations).not.toBeNull();
  });

  it("stores a KML file whatever it is named — the bytes decide", async () => {
    const res = await upload(flightId, kmlTrack(10), "download.xml");
    expect(res.status).toBe(201);
    expect(res.body.track.source).toBe("kml");
  });

  it("places an untimed line in the flight's own schedule", async () => {
    const res = await upload(flightId, kmlLine(20), "route.kml");
    expect(res.status).toBe(201);
    const stored = await prisma.flightTrack.findUniqueOrThrow({ where: { flightId } });
    expect(stored.startedAt.toISOString()).toBe("2026-10-03T08:00:00.000Z");
    expect(stored.endedAt.toISOString()).toBe("2026-10-03T19:00:00.000Z");
    // No altitude in the file — none invented.
    expect(stored.elevations).toBeNull();
  });

  it("refuses an untimed line on a flight with no schedule to place it in", async () => {
    const res = await upload(unscheduledFlightId, kmlLine(20), "route.kml");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRACK_NO_TIMESTAMPS");
    expect(await prisma.flightTrack.count({ where: { flightId: unscheduledFlightId } })).toBe(0);
  });

  it.each([
    [
      "a day-only flight (noon placeholders)",
      {
        departureTime: new Date("2026-10-03T12:00:00Z"),
        arrivalTime: new Date("2026-10-03T12:00:00Z"),
        depTimeSemantics: "DATE_ONLY",
        arrTimeSemantics: "DATE_ONLY",
      },
    ],
    [
      "a year-only flight (period placeholders)",
      {
        departureTime: new Date("2026-01-01T00:00:00Z"),
        arrivalTime: new Date("2026-01-01T00:00:00Z"),
        depTimeSemantics: "UNKNOWN",
        arrTimeSemantics: "UNKNOWN",
        depPrecision: "year",
      },
    ],
  ])("refuses an untimed line on %s rather than invent its times", async (_label, clock) => {
    const flight = await prisma.flight.create({
      data: {
        userId,
        depIata: "MUC",
        arrIata: "ICN",
        depLat: 48.354,
        depLon: 11.786,
        arrLat: 37.469,
        arrLon: 126.451,
        flightNumber: "LH718",
        status: "historical",
        ...clock,
      },
    });
    const res = await upload(flight.id, kmlLine(20), "route.kml");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRACK_NO_TIMESTAMPS");
    expect(await prisma.flightTrack.count({ where: { flightId: flight.id } })).toBe(0);
  });

  it.each([
    ["broken XML", Buffer.from("<gpx><trk><trkseg><trkpt lat="), "broken.gpx"],
    ["a KML with a single position", kmlLine(1), "one.kml"],
    ["a file that is no track at all", Buffer.from("%PDF-1.7 not a track"), "ticket.pdf"],
  ])("refuses %s with TRACK_FILE_UNREADABLE", async (_label, file, name) => {
    const res = await upload(flightId, file, name);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRACK_FILE_UNREADABLE");
    expect(await prisma.flightTrack.count({ where: { flightId } })).toBe(0);
  });

  it("refuses a request without a file", async () => {
    const res = await request(app)
      .post(`/api/v1/flights/${flightId}/track/file`)
      .set("Cookie", cookie)
      .field("replace", "false");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRACK_FILE_MISSING");
  });

  it("refuses a file over the size limit", async () => {
    const big = Buffer.alloc(FILE_LIMITS.GPX_TRACK_MAX_SIZE + 1, " ");
    const res = await upload(flightId, big, "huge.gpx");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("TRACK_FILE_TOO_LARGE");
  });

  it("refuses a recording a day away from the flight", async () => {
    const res = await upload(flightId, gpx(10, DEPARTURE + 36 * 3_600_000), "late.gpx");
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("TRACK_OUTSIDE_FLIGHT");
  });

  it("refuses an invalid replace field", async () => {
    const res = await upload(flightId, gpx(10), "a.gpx").field("replace", "maybe");
    expect(res.status).toBe(400);
  });

  it("answers the same file twice as a replay and writes nothing", async () => {
    const first = await upload(flightId, gpx(30), "a.gpx");
    const again = await upload(flightId, gpx(30), "renamed.gpx");
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.track.id).toBe(first.body.track.id);
  });

  it("never displaces a stored recording unless asked to replace it", async () => {
    await upload(flightId, gpx(60), "full.gpx");
    const refused = await upload(flightId, kmlTrack(5), "partial.kml");
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("TRACK_ALREADY_RECORDED");
    expect((await prisma.flightTrack.findUniqueOrThrow({ where: { flightId } })).pointCount).toBe(
      60
    );

    const replaced = await upload(flightId, kmlTrack(5), "partial.kml", true);
    expect(replaced.status).toBe(201);
    const now = await prisma.flightTrack.findUniqueOrThrow({ where: { flightId } });
    expect(now).toMatchObject({ source: "kml", pointCount: 5 });
  });

  it("answers another user's flight like a missing one", async () => {
    const res = await upload(otherFlightId, gpx(10), "a.gpx");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("FLIGHT_NOT_FOUND");
    expect(await prisma.flightTrack.count({ where: { flightId: otherFlightId } })).toBe(0);
  });
});

describe("Recorded flight lines for the map — GET /flights/track-lines", () => {
  let cookie: string;
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["fltlines", "fltlinesother"] } } });
    userId = (
      await prisma.user.create({
        data: { username: "fltlines", passwordHash: await hashPassword("password123") },
      })
    ).id;
    otherUserId = (
      await prisma.user.create({
        data: { username: "fltlinesother", passwordHash: await hashPassword("password123") },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("serves the caller's recorded lines only, keyed by flight", async () => {
    const base = { depIata: "MUC", arrIata: "FRA", depLat: 48, depLon: 11, arrLat: 50, arrLon: 8 };
    const mine = await prisma.flight.create({ data: { ...base, userId } });
    const bare = await prisma.flight.create({ data: { ...base, userId } });
    const theirs = await prisma.flight.create({ data: { ...base, userId: otherUserId } });
    const row = {
      source: "gpx",
      uploadId: "u",
      startedAt: new Date(DEPARTURE),
      endedAt: new Date(DEPARTURE + 3_600_000),
      geometry: [
        [11, 48],
        [9, 49],
        [8.5, 49.5],
        [8, 50],
      ],
      segmentStarts: [0, 2],
      cumulativeKm: [0, 160, 160, 230],
      pointCount: 4,
      distanceKm: 230,
    };
    await prisma.flightTrack.create({ data: { ...row, flightId: mine.id } });
    await prisma.flightTrack.create({ data: { ...row, flightId: theirs.id } });

    const res = await request(app).get("/api/v1/flights/track-lines").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      lines: [{ flightId: mine.id, geometry: row.geometry, segmentStarts: [0, 2] }],
    });
    expect(JSON.stringify(res.body)).not.toContain(bare.id);
  });

  it("needs a login", async () => {
    const res = await request(app).get("/api/v1/flights/track-lines");
    expect(res.status).toBe(401);
  });
});
