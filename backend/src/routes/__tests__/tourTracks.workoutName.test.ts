import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * A Companion workout's generated name carries the clock of the phone's zone
 * (prod, 2026-10-09: imported in Seoul, UTC+9, a hike in Madagascar, UTC+3,
 * named 14:10 for an 08:10 start). The upload re-reads it at the track's first
 * point — for the track and for the tour the Companion made under that name.
 */

const NAME = "Wanderung am 28.05.2026, 14:10";
const workoutGpx = (name: string) => `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TravStats Companion"><trk><name>${name}</name><trkseg>
  <trkpt lat="-18.8792" lon="47.5079"><time>2026-05-28T05:10:58Z</time></trkpt>
  <trkpt lat="-18.8800" lon="47.5090"><time>2026-05-28T05:12:00Z</time></trkpt>
  <trkpt lat="-18.8810" lon="47.5100"><time>2026-05-28T05:14:00Z</time></trkpt>
</trkseg></trk></gpx>`;

describe("Tour tracks — a workout's name shows the place's clock", () => {
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourtrackworkoutname" } });
    const u = await prisma.user.create({
      data: { username: "tourtrackworkoutname", passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tourtrackworkoutname" } });
    await prisma.$disconnect();
  });

  async function tourNamed(name: string): Promise<string> {
    const tour = await request(app)
      .post("/api/v1/tours")
      .set("Cookie", cookie)
      .send({ name, mode: "foot" });
    expect(tour.status).toBe(201);
    return tour.body.route.id as string;
  }

  const upload = (routeId: string, fields: Record<string, string>) => {
    let req = request(app).post(`/api/v1/tours/${routeId}/tracks`).set("Cookie", cookie);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach("file", Buffer.from(workoutGpx(NAME)), "workout.gpx");
  };

  it("renames a HealthKit workout's track and its tour to the local start time", async () => {
    const routeId = await tourNamed(NAME);
    const res = await upload(routeId, { externalRef: "HK-MADAGASCAR-1", origin: "healthkit" });
    expect(res.status).toBe(201);
    expect(res.body.track.name).toBe("Wanderung am 28.05.2026, 08:10");
    const route = await prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId } });
    expect(route.name).toBe("Wanderung am 28.05.2026, 08:10");
  });

  it("does not rename a tour the user has renamed since", async () => {
    const routeId = await tourNamed("Ankarana mit Mia");
    const res = await upload(routeId, { externalRef: "HK-MADAGASCAR-2", origin: "healthkit" });
    expect(res.body.track.name).toBe("Wanderung am 28.05.2026, 08:10");
    const route = await prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId } });
    expect(route.name).toBe("Ankarana mit Mia");
  });

  it("leaves the name of a plain GPX upload as the file has it", async () => {
    const routeId = await tourNamed(NAME);
    const res = await upload(routeId, {});
    expect(res.status).toBe(201);
    expect(res.body.track.name).toBe(NAME);
  });
});
