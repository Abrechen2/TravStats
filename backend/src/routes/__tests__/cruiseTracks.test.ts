import request from "supertest";
import { jest } from "@jest/globals";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { encryptApiKey } from "../../utils/encryption";

/**
 * Recorded tracks of a cruise (2.7): upload, coverage, the precedence of a
 * recording over the drawn line and the sea route, and that nobody can attach
 * to, read or remove another user's recording.
 *
 * Three ports in the open North Sea on one meridian, so the recording below
 * is a straight line and every expected distance is arithmetic.
 */

const KM_PER_DEG = 111.2;

interface Pt {
  lat: number;
  lon: number;
}

function meridian(fromLat: number, toLat: number, step = 0.05): Pt[] {
  const out: Pt[] = [];
  const dir = toLat >= fromLat ? 1 : -1;
  const n = Math.round(Math.abs(toLat - fromLat) / step);
  for (let i = 0; i <= n; i++) out.push({ lat: +(fromLat + dir * i * step).toFixed(6), lon: 4.5 });
  return out;
}

/** One `<trkseg>`, one point every ten minutes from 2026-06-01. */
function gpx(points: Pt[]): Buffer {
  const start = Date.parse("2026-06-01T08:00:00Z");
  const body = points
    .map(
      (p, i) =>
        `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(start + i * 600_000).toISOString()}</time></trkpt>`
    )
    .join("\n");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test"><trk><name>Voyage</name><trkseg>\n${body}\n</trkseg></trk></gpx>`
  );
}

describe("Cruise recorded tracks", () => {
  const realFetch = global.fetch;
  let cookie: string;
  let otherCookie: string;
  let userId: string;
  let otherUserId: string;
  let portIds: number[] = [];
  let cruiseId: string;
  let otherCruiseId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["crtracks", "crtracksother"] } } });
    const u = await prisma.user.create({
      data: { username: "crtracks", passwordHash: await hashPassword("password123") },
    });
    const o = await prisma.user.create({
      data: { username: "crtracksother", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    otherUserId = o.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    otherCookie = `auth_token=${generateToken(o.id)}`;

    const ports = await Promise.all(
      [54, 56, 58].map((lat, i) =>
        prisma.port.create({
          data: { name: `CrTracks Port ${i}`, lat, lon: 4.5, isUserAdded: true },
        })
      )
    );
    portIds = ports.map((p) => p.id);
  });

  beforeEach(async () => {
    await prisma.cruise.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    const c = await prisma.cruise.create({
      data: {
        userId,
        departurePortId: portIds[0],
        arrivalPortId: portIds[2],
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-03"),
        status: "completed",
        stops: {
          create: [
            { portId: portIds[1], dayNumber: 2, isAtSea: false, date: new Date("2026-06-02") },
          ],
        },
      },
    });
    cruiseId = c.id;
    const other = await prisma.cruise.create({
      data: {
        userId: otherUserId,
        departurePortId: portIds[0],
        arrivalPortId: portIds[1],
        status: "completed",
      },
    });
    otherCruiseId = other.id;
    await prisma.userSettings.deleteMany({ where: { userId } });
    delete process.env.DAWARICH_BASE_URL;
    delete process.env.DAWARICH_API_KEY;
    global.fetch = realFetch;
  });

  afterAll(async () => {
    global.fetch = realFetch;
    await prisma.cruise.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.port.deleteMany({ where: { id: { in: portIds } } });
    await prisma.$disconnect();
  });

  const upload = (buffer: Buffer, as = cookie, target = cruiseId) =>
    request(app)
      .post(`/api/v1/cruises/${target}/tracks`)
      .set("Cookie", as)
      .attach("file", buffer, "voyage.gpx");

  const legs = () =>
    prisma.cruiseLeg.findMany({ where: { cruiseId }, orderBy: { ordinal: "asc" } });

  it("measures every covered leg along the recording and labels the map line as recorded", async () => {
    const res = await upload(gpx(meridian(54, 58)));
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const [ab, bc] = await legs();
    expect(ab.method).toBe("recorded_track");
    expect(ab.confidence).toBe("high");
    expect(ab.distanceKm).toBeCloseTo(2 * KM_PER_DEG, -1);
    expect(bc.method).toBe("recorded_track");

    const geometry = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/geometry`)
      .set("Cookie", cookie);
    const [feature] = geometry.body.data.features;
    expect(feature.properties).toMatchObject({
      method: "recorded_track",
      geometrySource: "track",
      trackId: res.body.data.id,
    });
    // Every vertex protected: the client draws the recording as measured.
    expect(feature.properties.protectedPrefixCount).toBe(feature.geometry.coordinates.length);
    expect(feature.geometry.coordinates[0]).toEqual([4.5, 54]);

    const batch = await request(app)
      .post("/api/v1/cruises/geometry/batch")
      .set("Cookie", cookie)
      .send({ ids: [cruiseId] });
    expect(batch.body.data[cruiseId].features[1].properties.geometrySource).toBe("track");

    const overview = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/tracks`)
      .set("Cookie", cookie);
    expect(overview.status).toBe(200);
    expect(overview.body.data.tracks).toHaveLength(1);
    expect(overview.body.data.tracks[0]).not.toHaveProperty("geometry");
    expect(overview.body.data.tracks[0].coveredLegs).toEqual([0, 1]);
    expect(overview.body.data.legs[0]).toMatchObject({
      geometrySource: "track",
      coverage: { status: "covered", reason: "complete" },
    });
  });

  it("leaves a leg the recording started after on the sea route and says why", async () => {
    await upload(gpx(meridian(56, 58)));
    const [ab, bc] = await legs();
    expect(ab.method).not.toBe("recorded_track");
    expect(bc.method).toBe("recorded_track");

    const overview = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/tracks`)
      .set("Cookie", cookie);
    expect(overview.body.data.legs[0].coverage).toMatchObject({
      status: "notCovered",
      reason: "missesFrom",
    });
    expect(overview.body.data.legs[0].geometrySource).not.toBe("track");
  });

  it("bridges a hole at sea, counts its chord and lowers the confidence", async () => {
    // 0.3° (33 km) of silence halfway between the first two ports.
    const points = [...meridian(54, 55), ...meridian(55.3, 56)];
    await upload(gpx(points));
    const [ab] = await legs();
    expect(ab.method).toBe("recorded_track");
    expect(ab.confidence).toBe("medium");
    expect(ab.distanceKm).toBeCloseTo(2 * KM_PER_DEG, -1);
    const track = await prisma.cruiseTrack.findFirstOrThrow({ where: { cruiseId } });
    expect(track.segmentStarts as number[]).toHaveLength(2);
    // The recording's own figure leaves the hole out: it was not recorded.
    expect(track.distanceKm).toBeCloseTo(1.7 * KM_PER_DEG, -1);
  });

  // Browser acceptance 2026-09-26: a GPX of 41 points across ~900 km — one
  // point every ~22 km, as a phone logging hourly or an exported, thinned
  // track produces — was stored as "0 km · covers no leg": every step was
  // longer than the 20 km hole limit, so the whole file became holes.
  it("measures a sparse recording instead of calling every step a hole", async () => {
    const res = await upload(gpx(meridian(54, 58, 0.2)));
    expect(res.status).toBe(201);

    const track = await prisma.cruiseTrack.findFirstOrThrow({ where: { cruiseId } });
    expect(track.segmentStarts as number[]).toEqual([0]);
    expect(track.distanceKm).toBeCloseTo(4 * KM_PER_DEG, -1);

    const overview = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/tracks`)
      .set("Cookie", cookie);
    expect(overview.body.data.tracks[0].distanceKm).toBeCloseTo(4 * KM_PER_DEG, -1);
    expect(overview.body.data.tracks[0].coveredLegs).toEqual([0, 1]);
    const [ab] = await legs();
    expect(ab.method).toBe("recorded_track");
  });

  it("still marks a real hole in a sparse recording", async () => {
    // ~22 km steps, then 1.2° (133 km) of silence.
    const points = [...meridian(54, 55, 0.2), ...meridian(56.2, 58, 0.2)];
    await upload(gpx(points));
    const track = await prisma.cruiseTrack.findFirstOrThrow({ where: { cruiseId } });
    expect(track.segmentStarts as number[]).toHaveLength(2);
  });

  it("wins over a drawn line, and gives the leg back to it when removed", async () => {
    await prisma.cruiseLegRoute.create({
      data: {
        cruiseId,
        fromKind: "port",
        fromRef: String(portIds[0]),
        toKind: "port",
        toRef: String(portIds[1]),
        waypoints: [
          [4.5, 54],
          [3.5, 55],
          [4.5, 56],
        ],
      },
    });
    const res = await upload(gpx(meridian(54, 58)));
    expect((await legs())[0].method).toBe("recorded_track");

    const removed = await request(app)
      .delete(`/api/v1/cruises/${cruiseId}/tracks/${res.body.data.id}`)
      .set("Cookie", cookie);
    expect(removed.status).toBe(200);
    expect((await legs())[0].method).toBe("manual_polyline");
    const geometry = await request(app)
      .get(`/api/v1/cruises/${cruiseId}/geometry`)
      .set("Cookie", cookie);
    expect(geometry.body.data.features[0].properties.geometrySource).toBe("drawn");
  });

  it("refuses the same exported recording twice", async () => {
    const send = () =>
      request(app)
        .post(`/api/v1/cruises/${cruiseId}/tracks`)
        .set("Cookie", cookie)
        .field("externalRef", "workout-1")
        .attach("file", gpx(meridian(54, 56)), "voyage.gpx");
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(409);
  });

  describe("another user", () => {
    it("cannot attach a recording to my cruise", async () => {
      const res = await upload(gpx(meridian(54, 58)), otherCookie);
      expect(res.status).toBe(404);
      expect(await prisma.cruiseTrack.count({ where: { cruiseId } })).toBe(0);
    });

    it("cannot read my cruise's recordings", async () => {
      await upload(gpx(meridian(54, 58)));
      const res = await request(app)
        .get(`/api/v1/cruises/${cruiseId}/tracks`)
        .set("Cookie", otherCookie);
      expect(res.status).toBe(404);
    });

    it("cannot remove my recording, through my cruise or through their own", async () => {
      const mine = await upload(gpx(meridian(54, 58)));
      const trackId = mine.body.data.id as string;

      const viaMine = await request(app)
        .delete(`/api/v1/cruises/${cruiseId}/tracks/${trackId}`)
        .set("Cookie", otherCookie);
      expect(viaMine.status).toBe(404);

      const viaTheirs = await request(app)
        .delete(`/api/v1/cruises/${otherCruiseId}/tracks/${trackId}`)
        .set("Cookie", otherCookie);
      expect(viaTheirs.status).toBe(404);

      expect(await prisma.cruiseTrack.count({ where: { id: trackId } })).toBe(1);
      expect((await legs())[0].method).toBe("recorded_track");
    });
  });

  describe("pull from Dawarich", () => {
    const fakeOk = (body: unknown) =>
      ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => body,
      }) as unknown as Response;

    /** Newest first, string coordinates, second timestamps — Dawarich 1.9.2. */
    const dawarichPoints = (points: Pt[]) =>
      points
        .map((p, i) => ({
          id: i + 1,
          latitude: String(p.lat),
          longitude: String(p.lon),
          timestamp: Math.floor(Date.parse("2026-06-01T08:00:00Z") / 1000) + i * 600,
          track_id: null,
        }))
        .reverse();

    it("answers notConfigured without a connection", async () => {
      const res = await request(app)
        .post(`/api/v1/cruises/${cruiseId}/tracks/dawarich`)
        .set("Cookie", cookie)
        .send({ legOrdinal: 0 });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("notConfigured");
    });

    it("asks for the leg's own window and marks the hours without signal as holes", async () => {
      await prisma.userSettings.create({
        data: {
          userId,
          data: {},
          dawarichBaseUrl: "https://dawarich.lan",
          dawarichApiKey: encryptApiKey("sk-test"),
        },
      });
      const fetchMock = jest.fn(async () =>
        fakeOk(dawarichPoints([...meridian(54, 55), ...meridian(55.3, 56)]))
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const res = await request(app)
        .post(`/api/v1/cruises/${cruiseId}/tracks/dawarich`)
        .set("Cookie", cookie)
        .send({ legOrdinal: 0 });
      expect(res.status).toBe(201);

      const url = new URL(fetchMock.mock.calls[0][0] as unknown as string);
      // Leg 0 runs from the cruise's first day to the stop's day, widened 14 h.
      expect(url.searchParams.get("start_at")).toBe("2026-05-31T10:00:00.000Z");
      expect(url.searchParams.get("end_at")).toBe("2026-06-03T14:00:00.000Z");

      const track = await prisma.cruiseTrack.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(track.source).toBe("dawarich");
      expect(track.segmentStarts as number[]).toHaveLength(2);
      expect((await legs())[0].method).toBe("recorded_track");
    });

    it("refuses a leg the cruise does not have", async () => {
      const res = await request(app)
        .post(`/api/v1/cruises/${cruiseId}/tracks/dawarich`)
        .set("Cookie", cookie)
        .send({ legOrdinal: 7 });
      expect(res.status).toBe(404);
    });
  });
});
