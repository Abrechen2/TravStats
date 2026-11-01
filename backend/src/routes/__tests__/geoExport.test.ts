import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * forgejo#402: GPX / KML downloads. Every route: the owner gets a valid file
 * (a name with `<&"` is escaped), another user gets a 404, a record with no
 * line gets 422 GEO_EXPORT_EMPTY.
 */
const NASTY = `Tom & "Jerry" <b>`;
const PREFIX = `geoexp-${Date.now()}`;
const coords = { depLat: 1, depLon: 2, arrLat: 3, arrLon: 4 };
const line = [
  [2, 1],
  [2.5, 1.5],
  [4, 3],
  [4.5, 3.5],
];

describe("GPX/KML export (forgejo#402)", () => {
  let cookie: string;
  let strangerCookie: string;
  let userId: string;
  const id: Record<string, string> = {};
  const get = (path: string, as = cookie) => request(app).get(path).set("Cookie", as);

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: PREFIX, passwordHash } })).id;
    const strangerId = (
      await prisma.user.create({ data: { username: `${PREFIX}-other`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;
    const flightBase = {
      userId,
      depIata: "AAA",
      arrIata: "BBB",
      ...coords,
      departureTime: new Date("2026-05-02T03:00:00Z"),
      arrivalTime: new Date("2026-05-02T05:00:00Z"),
      status: "flown",
    };
    id.flight = (await prisma.flight.create({ data: { ...flightBase, flightNumber: NASTY } })).id;
    id.flightBare = (await prisma.flight.create({ data: flightBase })).id;
    await prisma.flightTrack.create({
      data: {
        flightId: id.flight,
        source: "gpx",
        uploadId: "u1",
        startedAt: new Date("2026-05-02T03:00:00Z"),
        endedAt: new Date("2026-05-02T05:00:00Z"),
        geometry: line,
        segmentStarts: [0, 2],
        cumulativeKm: [0, 1, 2, 3],
        pointCount: 4,
        distanceKm: 3,
      },
    });
    id.cruise = (
      await prisma.cruise.create({
        data: {
          userId,
          cruiseLine: "X",
          routeName: NASTY,
          startDate: new Date("2023-05-01T00:00:00Z"),
          status: "flown",
        },
      })
    ).id;
    id.cruiseBare = (
      await prisma.cruise.create({
        data: { userId, cruiseLine: "X", startDate: new Date("2023-05-01"), status: "flown" },
      })
    ).id;
    await prisma.cruiseTrack.create({
      data: {
        cruiseId: id.cruise,
        source: "gpx",
        name: NASTY,
        startedAt: new Date("2023-05-01T00:00:00Z"),
        endedAt: new Date("2023-05-02T00:00:00Z"),
        geometry: line,
        segmentStarts: [0],
        cumulativeKm: [0, 1, 2, 3],
        pointCount: 4,
        distanceKm: 3,
      },
    });
    const ride = {
      userId,
      depStationName: NASTY,
      arrStationName: "B",
      ...coords,
      departureTime: new Date("2025-01-01T08:00Z"),
      status: "completed",
    };
    id.rail = (await prisma.railJourney.create({ data: { ...ride, geometry: line } as never })).id;
    id.railBare = (await prisma.railJourney.create({ data: ride as never })).id;
    id.bus = (await prisma.busJourney.create({ data: { ...ride, geometry: line } as never })).id;
    id.busBare = (await prisma.busJourney.create({ data: ride as never })).id;
    id.ferry = (
      await prisma.ferryJourney.create({ data: { ...ride, geometry: line } as never })
    ).id;
    id.ferryBare = (await prisma.ferryJourney.create({ data: ride as never })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  const escaped = (body: string) => {
    expect(body).toContain("Tom &amp; &quot;Jerry&quot; &lt;b&gt;");
    expect(body).not.toContain(NASTY);
  };

  describe.each([
    [
      "flight track",
      () => `/api/v1/flights/${id.flight}/track/export`,
      () => `/api/v1/flights/${id.flightBare}/track/export`,
      2,
    ],
    [
      "cruise tracks",
      () => `/api/v1/cruises/${id.cruise}/tracks/export`,
      () => `/api/v1/cruises/${id.cruiseBare}/tracks/export`,
      1,
    ],
    [
      "rail line",
      () => `/api/v1/rail/${id.rail}/line/export`,
      () => `/api/v1/rail/${id.railBare}/line/export`,
      1,
    ],
    [
      "bus line",
      () => `/api/v1/bus/${id.bus}/line/export`,
      () => `/api/v1/bus/${id.busBare}/line/export`,
      1,
    ],
    [
      "ferry line",
      () => `/api/v1/ferry/${id.ferry}/line/export`,
      () => `/api/v1/ferry/${id.ferryBare}/line/export`,
      1,
    ],
  ] as const)("%s", (_label, path, barePath, segments) => {
    it("gives the owner a valid GPX file with the name escaped", async () => {
      const res = await get(path());
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/gpx+xml");
      expect(res.headers["content-disposition"]).toMatch(/attachment; filename="[\w.-]+\.gpx"/);
      expect(res.text.startsWith(`<?xml version="1.0" encoding="UTF-8"?>`)).toBe(true);
      expect(res.text.match(/<trkseg>/g)).toHaveLength(segments);
      expect(res.text).toContain(`<trkpt lat="1" lon="2"/>`);
      expect(res.text.trimEnd().endsWith("</gpx>")).toBe(true);
      escaped(res.text);
    });

    it("gives the owner KML with lon,lat order on ?format=kml", async () => {
      const res = await get(`${path()}?format=kml`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("kml");
      expect(res.text).toContain("<coordinates>2,1 2.5,1.5");
      expect(res.text.trimEnd().endsWith("</kml>")).toBe(true);
      escaped(res.text);
    });

    it("answers another user's record with 404, like a missing one", async () => {
      expect((await get(path(), strangerCookie)).status).toBe(404);
    });

    it("answers a record with no line 422 GEO_EXPORT_EMPTY, not an empty file", async () => {
      const res = await get(barePath());
      expect(res.status).toBe(422);
      expect(res.body.code).toBe("GEO_EXPORT_EMPTY");
    });

    it("rejects an unknown format and a malformed id", async () => {
      expect((await get(`${path()}?format=pdf`)).status).toBe(400);
      expect((await get(path().replace(/[0-9a-f-]{36}/, "nope"))).status).toBe(400);
    });
  });

  describe("places", () => {
    it("answers 422 GEO_EXPORT_EMPTY before there is a place", async () => {
      const res = await get("/api/v1/places/export");
      expect(res.status).toBe(422);
      expect(res.body.code).toBe("GEO_EXPORT_EMPTY");
    });

    it("writes every place as a waypoint, or only one list's, to the owner only", async () => {
      const a = await prisma.place.create({
        data: { userId, name: NASTY, lat: 10.5, lon: 20.25, category: "cafe", city: "Rome" },
      });
      await prisma.place.create({ data: { userId, name: "Other", lat: 1, lon: 2 } });
      const list = await prisma.placeList.create({ data: { userId, name: NASTY } });
      await prisma.placeListEntry.create({ data: { listId: list.id, placeId: a.id } });

      const all = await get("/api/v1/places/export");
      expect(all.status).toBe(200);
      expect(all.text.match(/<wpt /g)).toHaveLength(2);
      expect(all.text).toContain(`<wpt lat="10.5" lon="20.25">`);
      escaped(all.text);

      const one = await get(`/api/v1/places/export?listId=${list.id}&format=kml`);
      expect(one.status).toBe(200);
      expect(one.text.match(/<Point>/g)).toHaveLength(1);
      expect(one.text).toContain("<coordinates>20.25,10.5</coordinates>");
      escaped(one.text);

      expect((await get(`/api/v1/places/export?listId=${list.id}`, strangerCookie)).status).toBe(
        404
      );
      expect((await get("/api/v1/places/export", strangerCookie)).status).toBe(422);
    });
  });
});
