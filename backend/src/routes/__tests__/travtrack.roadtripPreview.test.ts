import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";
import { generateToken } from "../../utils/jwt";

/**
 * "Als Roadtrip übernehmen" (rc46 extras A): the preview of a recorded day,
 * and the roadtrip written through the roadtrip and tour APIs with the track
 * as its drawn line and the span it links back to.
 */

const PREFIX = "travtrack-roadtrip-";
const MIN = 60_000;
const DAY_START = Date.parse("2026-10-11T22:00:00Z"); // 12 Oct 00:00 in Berlin
const T0 = DAY_START + 8 * 60 * MIN;

describe("TravTrack — roadtrip from a recorded span", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;

  const preview = (query: object) =>
    request(app).get("/api/v1/travtrack/roadtrip-preview").query(query).set("Cookie", cookie);

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.tripRoute.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({
      data: {
        userId,
        enabledDomains: ["flight", "tour"],
        data: { display: { timezone: "Europe/Berlin" } },
      },
    });
    // Drive north 0–40, an hour at a lake, drive on 100–140.
    for (let m = 0; m <= 40; m++) {
      await storePoint(userId, { t: T0 + m * MIN, lat: 48 + m * 0.004, lon: 7.8, accuracyM: 10 });
    }
    for (let m = 45; m <= 95; m += 5) {
      await storePoint(userId, { t: T0 + m * MIN, lat: 48.16, lon: 7.8, motion: "stationary" });
    }
    for (let m = 100; m <= 140; m++) {
      await storePoint(userId, {
        t: T0 + m * MIN,
        lat: 48.16 + (m - 100) * 0.004,
        lon: 7.8,
        accuracyM: 10,
      });
    }
    await prisma.place.create({ data: { userId, name: "Titisee", lat: 48.1601, lon: 7.8001 } });
  });

  afterAll(async () => {
    await switches.restore();
    await wipeTravTrack([userId]);
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("previews start, the lake (linked to the place) and the end, with the distance", async () => {
    const res = await preview({ fromDay: "2026-10-12", toDay: "2026-10-12" });
    expect(res.status).toBe(200);
    expect(res.body.stations.map((s: { kind: string }) => s.kind)).toEqual([
      "start",
      "stop",
      "end",
    ]);
    expect(res.body.stations[1]).toMatchObject({ name: "Titisee", placeId: expect.any(String) });
    expect(res.body.distanceKm).toBeGreaterThan(30);
    expect(res.body.legs).toHaveLength(2);
  });

  it("refuses a span longer than two weeks as itself", async () => {
    const res = await preview({ fromDay: "2026-10-01", toDay: "2026-10-30" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "TRAVTRACK_ROADTRIP_PREVIEW_FAILED",
      reason: "tooLong",
    });
  });

  it("says when a span holds nothing to take over", async () => {
    const res = await preview({ fromDay: "2026-10-20", toDay: "2026-10-20" });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe("noPoints");
  });

  it("creates the roadtrip with the track as its drawn line, which a re-route leaves alone", async () => {
    const p = (await preview({ fromDay: "2026-10-12", toDay: "2026-10-12" })).body;
    const created = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Schwarzwald", trackSpan: { fromDay: "2026-10-12", toDay: "2026-10-12" } })
      .expect(201);
    const id = created.body.roadtrip.id;
    expect(created.body.roadtrip.trackSpan).toEqual({ fromDay: "2026-10-12", toDay: "2026-10-12" });

    const stations = await request(app)
      .put(`/api/v1/roadtrips/${id}/stations`)
      .set("Cookie", cookie)
      .send({
        stations: p.stations.map(
          (
            s: { name: string | null; lat: number; lon: number; placeId: string | null },
            i: number
          ) => ({
            title: s.name ?? `Halt ${i + 1}`,
            lat: s.lat,
            lon: s.lon,
            startDate: "2026-10-12",
            endDate: "2026-10-12",
            night: { kind: "pass", placeId: s.placeId },
          })
        ),
      })
      .expect(200);
    const ids = stations.body.stations.map((s: { id: string }) => s.id);
    for (let i = 1; i < ids.length; i++) {
      await request(app)
        .put(`/api/v1/tours/${id}/legs/${ids[i - 1]}/${ids[i]}`)
        .set("Cookie", cookie)
        .send({ source: "drawn", waypoints: p.legs[i - 1].coordinates })
        .expect(200);
    }
    const lake = await prisma.tripStop.findFirstOrThrow({ where: { id: ids[1] } });
    expect(lake.placeId).toBe(p.stations[1].placeId);

    const routed = await request(app)
      .post(`/api/v1/tours/${id}/route-all`)
      .set("Cookie", cookie)
      .send({});
    expect([200, 409, 503]).toContain(routed.status);
    const legs = await prisma.tripRouteLeg.findMany({ where: { routeId: id } });
    expect(legs.map((l) => l.source)).toEqual(["drawn", "drawn"]);
  });
});
