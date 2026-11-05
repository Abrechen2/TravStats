jest.mock("../../services/geo/photon", () => ({
  ...jest.requireActual("../../services/geo/photon"),
  reversePlacesDetailed: jest.fn(),
}));
jest.mock("../../services/geo/nominatim", () => ({
  ...jest.requireActual("../../services/geo/nominatim"),
  reverseGeocodeDetailed: jest.fn(),
}));

import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { clearStayIdentityCache } from "../../services/dawarich/stays/identity";
import { reverseGeocodeDetailed } from "../../services/geo/nominatim";
import { reversePlacesDetailed } from "../../services/geo/photon";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";
import { buildTravTrackDataExport } from "../../services/travtrack/accountExport";
import { travTrackRange } from "../../services/travtrack/rangeView";
import { generateToken } from "../../utils/jwt";

/**
 * Stops of the day view: drawn without coarse-fix spikes, one stop for a wander
 * inside a place, a name for every stop (lookup + accepted name). The real day
 * (owner, 4 Nov 2026): an iPhone at ~1 Hz, two fallback fixes of 1.9 and 2.7 km
 * accuracy 1.3-1.5 km off, a 57 m wander in a hotel at night.
 */

const PREFIX = "travtrack-stopplaces-";
const MIN = 60_000;
const DAY_START = Date.parse("2026-10-11T15:00:00Z"); // 12 Oct 00:00 in Seoul
const T0 = DAY_START + 2 * 60 * MIN;
const LAT0 = 37.5;
const LON0 = 127;
const M = 111_195;

const places = reversePlacesDetailed as jest.Mock;
const geocode = reverseGeocodeDetailed as jest.Mock;

describe("TravTrack — stop places", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;

  const getDay = () =>
    request(app).get("/api/v1/travtrack/day").query({ date: "2026-10-12" }).set("Cookie", cookie);
  const getPlace = (query: object) =>
    request(app).get("/api/v1/travtrack/stops/place").query(query).set("Cookie", cookie);
  const putPlace = (body: object) =>
    request(app).put("/api/v1/travtrack/stops/place").set("Cookie", cookie).send(body);

  const stand = async (fromMin: number, toMin: number, dLatM = 0, accuracyM = 5) => {
    for (let m = fromMin; m <= toMin; m += 5) {
      await storePoint(userId, {
        t: T0 + m * MIN,
        lat: LAT0 + dLatM / M,
        lon: LON0,
        accuracyM,
        motion: "stationary",
      });
    }
  };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.travTrackStopPlace.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.userSettings.create({
      data: { userId, data: { display: { timezone: "Asia/Seoul" } } },
    });
    clearStayIdentityCache();
    places.mockReset();
    geocode.mockReset();
    places.mockResolvedValue({ results: [], degraded: false });
    geocode.mockResolvedValue({ parts: null, degraded: false });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("draws no coarse-fix spike: a 1.9 km accuracy fix is out of segments, ids and details, but stays stored", async () => {
    await stand(0, 30);
    await storePoint(userId, {
      t: T0 + 32 * MIN,
      lat: LAT0 + 1400 / M,
      lon: LON0,
      accuracyM: 1907,
    });
    await storePoint(userId, {
      t: T0 + 33 * MIN,
      lat: LAT0 + 1500 / M,
      lon: LON0,
      accuracyM: 2662,
    });
    await stand(35, 60);
    const day = (await getDay()).body;
    const vertices = day.segments.flat();
    expect(vertices.some((p: number[]) => p[3] !== null && p[3] > 1000)).toBe(false);
    expect(Math.max(...vertices.map((p: number[]) => p[1]))).toBeLessThan(LAT0 + 10 / M);
    expect(day.pointIds.map((s: string[]) => s.length)).toEqual(
      day.segments.map((s: unknown[]) => s.length)
    );
    expect(day.pointDetails.map((s: unknown[]) => s.length)).toEqual(
      day.segments.map((s: unknown[]) => s.length)
    );
    expect(day.pointIds.flat().every((id: string) => id !== "")).toBe(true);
    // The spike did not split the stand into stop, leg, stop either.
    expect(day.stops).toHaveLength(1);
    expect(day.legs).toHaveLength(0);
    // Raw storage keeps it.
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(7 + 2 + 6);
    // The range view draws without it as well.
    const range = await travTrackRange(
      userId,
      { fromMs: DAY_START, untilMs: DAY_START + 24 * 60 * MIN },
      null
    );
    expect(range.segments.flat().some((p) => p[3] !== null && p[3] > 1000)).toBe(false);
    expect(range.pointIds.flat().every((id) => id !== "")).toBe(true);
    const exported = await buildTravTrackDataExport(userId);
    expect(exported.points).toBeDefined();
  });

  it("a 57 m wander inside a hotel at night is one overnight stop, not stop, 'unknown' leg, stop", async () => {
    await stand(0, 50);
    await stand(51, 51, 57);
    await stand(56, 56, 30);
    await stand(61, 120);
    const { stops, legs } = (await getDay()).body;
    expect(legs).toHaveLength(0);
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ fromMs: T0, untilMs: T0 + 116 * MIN, place: null });
  });

  it("a real 300 m trip away and back is still two stops and legs", async () => {
    await stand(0, 20);
    for (let m = 21; m <= 29; m++) {
      await storePoint(userId, {
        t: T0 + m * MIN,
        lat: LAT0 + ((Math.min(m - 20, 30 - m) * 30) / M) * 1,
        lon: LON0,
        motion: "walking",
        speedMps: 1.4,
      });
    }
    await stand(30, 60);
    const { stops, legs } = (await getDay()).body;
    expect(stops).toHaveLength(2);
    expect(legs.length).toBeGreaterThan(0);
  });

  describe("GET /travtrack/stops/place", () => {
    const q = { lat: LAT0, lon: LON0, fromMs: T0, untilMs: T0 + 30 * MIN };

    it("names the nearest place first (a Lidl and a charger beat a far sight) and lists candidates", async () => {
      places.mockResolvedValue({
        degraded: false,
        results: [
          { name: "Old Church", lat: LAT0 + 90 / M, lon: LON0, type: "worship" },
          { name: "Ionity", lat: LAT0 + 30 / M, lon: LON0, type: "charging_station" },
          { name: "Lidl", lat: LAT0 + 10 / M, lon: LON0, type: "supermarket" },
        ],
      });
      const res = await getPlace(q);
      expect(res.status).toBe(200);
      expect(res.body.probable).toMatchObject({ name: "Lidl", source: "nearbyPlace" });
      expect(res.body.candidates.map((c: { name: string }) => c.name)).toEqual([
        "Lidl",
        "Ionity",
        "Old Church",
      ]);
      expect(res.body.known).toEqual([]);
      expect(places).toHaveBeenCalledWith(
        LAT0,
        LON0,
        expect.objectContaining({ radiusKm: 0.2, limit: 50 })
      );
    });

    it("honours the stay-suggestions switch: off asks no geocoder, but still names the owner's own place", async () => {
      await prisma.userSettings.update({
        where: { userId },
        data: { staySuggestionsEnabled: false },
      });
      await prisma.place.create({
        data: { userId, name: "Home", lat: LAT0 + 20 / M, lon: LON0, category: "other" } as never,
      });
      places.mockResolvedValue({
        degraded: false,
        results: [{ name: "Lidl", lat: LAT0 + 5 / M, lon: LON0 }],
      });
      const res = await getPlace(q);
      expect(res.status).toBe(200);
      expect(places).not.toHaveBeenCalled();
      expect(geocode).not.toHaveBeenCalled();
      expect(res.body).toMatchObject({
        lookup: "off",
        probable: { name: "Home", source: "known" },
        candidates: [],
      });
      expect(res.body.known[0]).toMatchObject({ name: "Home" });
    });

    it("switch off and no known place within 100 m: no probable, no lookup, says it is off", async () => {
      await prisma.userSettings.update({
        where: { userId },
        data: { staySuggestionsEnabled: false },
      });
      const res = await getPlace(q);
      expect(res.body).toMatchObject({ lookup: "off", probable: null, known: [], candidates: [] });
      expect(places).not.toHaveBeenCalled();
    });

    it("offers the charger, not the street or the vending machine beside it", async () => {
      places.mockResolvedValue({
        degraded: false,
        results: [
          { name: "Steinhaldenstrasse", lat: LAT0 + 9 / M, lon: LON0, type: "tertiary" },
          { name: "Snacks Drinks 24/7", lat: LAT0 + 12 / M, lon: LON0, type: "vending_machine" },
          { name: "Supercharger", lat: LAT0 + 31 / M, lon: LON0, type: "charging_station" },
        ],
      });
      const res = await getPlace(q);
      expect(res.body.probable).toMatchObject({ name: "Supercharger", source: "nearbyPlace" });
      expect(res.body.candidates.map((c: { name: string }) => c.name)).toEqual(["Supercharger"]);
    });

    it("prefers the owner's own place within 100 m over a geocoder candidate", async () => {
      await prisma.place.create({
        data: { userId, name: "Home", lat: LAT0 + 20 / M, lon: LON0, category: "other" } as never,
      });
      places.mockResolvedValue({
        degraded: false,
        results: [{ name: "Lidl", lat: LAT0 + 5 / M, lon: LON0 }],
      });
      const res = await getPlace(q);
      expect(res.body.probable).toMatchObject({ name: "Home", source: "known" });
      expect(res.body.known[0]).toMatchObject({ name: "Home", kind: "place" });
    });

    it("says the provider failed instead of answering an empty success", async () => {
      places.mockResolvedValue({ results: [], degraded: true });
      geocode.mockResolvedValue({ parts: null, degraded: true });
      const res = await getPlace(q);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        geocoder: "degraded",
        candidatesState: "degraded",
        probable: null,
      });
    });

    it("answers 400 for a bad position or span, 401 signed out, 403 while TravTrack is off", async () => {
      const bad = await getPlace({ ...q, lat: 123 });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe("TRAVTRACK_STOP_INVALID");
      expect((await getPlace({ ...q, untilMs: q.fromMs })).status).toBe(400);
      expect((await request(app).get("/api/v1/travtrack/stops/place").query(q)).status).toBe(401);
      await switches.set({ beta: true, config: false });
      expect((await getPlace(q)).status).toBe(403);
    });
  });

  describe("PUT /travtrack/stops/place", () => {
    it("stores the accepted name, the day carries it, and null removes it", async () => {
      await stand(0, 30);
      const span = { fromMs: T0, untilMs: T0 + 30 * MIN };
      const put = await putPlace({ ...span, place: { name: "Lidl", lat: LAT0, lon: LON0 } });
      expect(put.status).toBe(200);
      expect(put.body.place).toEqual({ name: "Lidl", lat: LAT0, lon: LON0, source: "accepted" });
      expect((await getDay()).body.stops[0].place).toMatchObject({ name: "Lidl" });
      const exported = await buildTravTrackDataExport(userId);
      expect(exported.stopPlaces).toHaveLength(1);
      const cleared = await putPlace({ ...span, place: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.place).toBeNull();
      expect((await getDay()).body.stops[0].place).toBeNull();
    });

    it("404s a span under no stop and stores nothing; 400s an empty name", async () => {
      const span = { fromMs: T0, untilMs: T0 + 30 * MIN };
      const none = await putPlace({ ...span, place: { name: "Lidl" } });
      expect(none.status).toBe(404);
      expect(none.body.code).toBe("TRAVTRACK_STOP_NOT_FOUND");
      expect(await prisma.travTrackStopPlace.count({ where: { userId } })).toBe(0);
      expect((await putPlace({ ...span, place: { name: "  " } })).status).toBe(400);
      expect((await request(app).put("/api/v1/travtrack/stops/place").send(span)).status).toBe(401);
    });
  });
});
