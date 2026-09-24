import request from "supertest";
import { FitBaseType, FitEncoder } from "fit-file-parser";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The upload takes TCX and FIT beside GPX, carries the climb and moving time
 * a day tour is read by, and refuses the same source record twice
 * (design 2026-09-24 §3.3, §5; the Companion's HealthKit import, companion#9).
 */

const HIKE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test"><trk><name>Preikestolen</name><trkseg>
  <trkpt lat="58.9860" lon="6.1900"><ele>270</ele><time>2026-07-15T08:40:00Z</time></trkpt>
  <trkpt lat="58.9869" lon="6.1900"><ele>350</ele><time>2026-07-15T08:41:00Z</time></trkpt>
  <trkpt lat="58.9878" lon="6.1900"><ele>480</ele><time>2026-07-15T08:42:00Z</time></trkpt>
  <trkpt lat="58.9887" lon="6.1900"><ele>604</ele><time>2026-07-15T08:43:00Z</time></trkpt>
</trkseg></trk></gpx>`;

const RIDE_TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase><Activities><Activity Sport="Biking"><Id>2026-07-16T10:00:00Z</Id>
<Lap StartTime="2026-07-16T10:00:00Z"><Track>
  <Trackpoint><Time>2026-07-16T10:00:00Z</Time><Position><LatitudeDegrees>59.00</LatitudeDegrees><LongitudeDegrees>6.00</LongitudeDegrees></Position><AltitudeMeters>10</AltitudeMeters></Trackpoint>
  <Trackpoint><Time>2026-07-16T10:01:00Z</Time><Position><LatitudeDegrees>59.004</LatitudeDegrees><LongitudeDegrees>6.00</LongitudeDegrees></Position><AltitudeMeters>60</AltitudeMeters></Trackpoint>
</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;

function fitFile(): Buffer {
  const semicircles = (deg: number) => Math.round((deg * 2 ** 31) / 180);
  const encoder = new FitEncoder();
  encoder.writeMessage(0, [{ number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 }]);
  [
    [58.98, 100, "2026-07-17T07:00:00Z"],
    [58.981, 140, "2026-07-17T07:01:00Z"],
  ].forEach(([lat, alt, at]) =>
    encoder.writeMessage(20, [
      {
        number: 253,
        size: 4,
        baseType: FitBaseType.Uint32,
        value: FitEncoder.toFitTimestamp(new Date(at as string)),
      },
      { number: 0, size: 4, baseType: FitBaseType.Sint32, value: semicircles(lat as number) },
      { number: 1, size: 4, baseType: FitBaseType.Sint32, value: semicircles(6.19) },
      {
        number: 78,
        size: 4,
        baseType: FitBaseType.Uint32,
        value: Math.round(((alt as number) + 500) * 5),
      },
    ])
  );
  return Buffer.from(encoder.close());
}

describe("Tour tracks — formats, figures and duplicates", () => {
  let cookie: string;
  let routeId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourtrackformats" } });
    const u = await prisma.user.create({
      data: { username: "tourtrackformats", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
    const tour = await request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name: "Preikestolen", mode: "foot" });
    routeId = tour.body.route.id as string;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourtrackformats" } });
    await prisma.$disconnect();
  });

  const upload = (body: Buffer | string, name: string, fields: Record<string, string> = {}) => {
    let req = request(app).post(`/api/v1/tours/${routeId}/tracks`).set("Cookie", cookie);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach("file", Buffer.isBuffer(body) ? body : Buffer.from(body), name);
  };

  it("stores the climb, the moving time and an elevation profile for a GPX", async () => {
    const res = await upload(HIKE_GPX, "hike.gpx");
    expect(res.status).toBe(201);
    expect(res.body.track).toMatchObject({
      source: "gpx",
      name: "Preikestolen",
      ascentM: 334,
      descentM: 0,
      movingSeconds: 180,
    });
    const detail = await request(app)
      .get(`/api/v1/tours/${routeId}/tracks/${res.body.track.id}`)
      .set("Cookie", cookie);
    expect(detail.body.track.elevationProfile.map((p: [number, number]) => p[1])).toEqual([
      270, 350, 480, 604,
    ]);
    expect(detail.body.track.cumulativeKm).toHaveLength(detail.body.track.geometry.length);
  });

  it("does not put the elevation profile on the list call", async () => {
    const res = await request(app).get(`/api/v1/tours/${routeId}/tracks`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    for (const t of res.body.tracks) {
      expect(t).not.toHaveProperty("elevationProfile");
      expect(t).not.toHaveProperty("geometry");
    }
  });

  it("accepts a TCX file", async () => {
    const res = await upload(RIDE_TCX, "ride.tcx");
    expect(res.status).toBe(201);
    expect(res.body.track).toMatchObject({ source: "tcx", ascentM: 50 });
  });

  it("accepts a FIT file, even under a misleading name", async () => {
    const res = await upload(fitFile(), "watch-export.gpx");
    expect(res.status).toBe(201);
    expect(res.body.track).toMatchObject({ source: "fit", ascentM: 40 });
  });

  it("marks a Companion HealthKit export by its origin and refuses it a second time", async () => {
    const first = await upload(HIKE_GPX, "workout.gpx", {
      externalRef: "8C9F3B2A-HEALTHKIT-UUID",
      origin: "healthkit",
    });
    expect(first.status).toBe(201);
    expect(first.body.track).toMatchObject({
      source: "healthkit",
      externalRef: "8C9F3B2A-HEALTHKIT-UUID",
    });

    const again = await upload(HIKE_GPX, "workout.gpx", {
      externalRef: "8C9F3B2A-HEALTHKIT-UUID",
      origin: "healthkit",
    });
    expect(again.status).toBe(409);
  });

  it("refuses an origin it does not know", async () => {
    const res = await upload(HIKE_GPX, "x.gpx", { origin: "garmin-connect" });
    expect(res.status).toBe(400);
  });

  it("refuses a file that is none of the three formats", async () => {
    const res = await upload("lat,lon\n58.98,6.19\n58.99,6.2", "points.csv");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/GPX, TCX or FIT/);
  });
});
