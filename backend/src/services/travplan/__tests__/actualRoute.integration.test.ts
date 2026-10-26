import { prisma } from "../../../db";
import { localDay } from "../../../shared/time/instant";
import { encryptApiKey } from "../../../utils/encryption";
import { setLocationProvider } from "../../locationProvider/provider";
import { distanceM } from "../../travtrack/classify";
import { makeUser, storePoint, wipeTravTrack } from "../../travtrack/__tests__/fixtures";
import { travTrackSwitches } from "../../travtrack/__tests__/switches";
import { getActualRoute } from "../actual/actualRoute";
import {
  MUNICH,
  SALZBURG,
  VIENNA,
  driveNear,
  makePlanTrip,
  noon,
  ownRecording,
} from "./planActualFixtures";

const getPoints = jest.fn();
jest.mock("../../dawarich/dawarichClient", () => ({
  ...jest.requireActual("../../dawarich/dawarichClient"),
  createDawarichClient: () => ({ getPoints, checkHealth: jest.fn() }),
}));

/**
 * Where the trip actually went (TravTrack plan L5): read through T5's
 * `tripEntryTrack`, so every origin answers alike, privacy-cut before
 * anything is counted and again on the final line.
 */

const PREFIX = "plan-actual-route-";
const viennaDay = (atMs: number) => localDay(new Date(atMs), "Europe/Vienna");

describe("getActualRoute", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let stranger: string;

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    stranger = await makeUser(`${PREFIX}b`);
  });
  beforeEach(async () => {
    getPoints.mockReset();
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.place.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("the own recording: positions with their day, the line, and which days hold data", async () => {
    const { tripId } = await makePlanTrip(userId);
    await ownRecording(userId, tripId, [
      ...driveNear(MUNICH, noon(1)),
      ...driveNear(VIENNA, noon(5)),
    ]);
    const route = await getActualRoute(userId, tripId);
    expect(route).toMatchObject({
      origin: "travstats",
      coverage: "complete",
      zone: "Europe/Vienna",
    });
    // Every privacy-safe fix's instant, in order: what a station's own days are read against.
    expect(route!.recordedAtMs).toHaveLength(8);
    expect(new Set(route!.positions.map((p) => viennaDay(p.atMs)))).toEqual(
      new Set(["2026-10-01", "2026-10-05"])
    );
    expect(route!.days).toEqual([
      { day: "2026-10-01", state: "recorded" },
      { day: "2026-10-02", state: "noData" },
      { day: "2026-10-03", state: "noData" },
      { day: "2026-10-04", state: "noData" },
      { day: "2026-10-05", state: "recorded" },
      { day: "2026-10-06", state: "noData" },
    ]);
    expect(route!.segments.length).toBeGreaterThan(0);
  });

  it("TravTrack points when TravTrack is the provider", async () => {
    const { tripId } = await makePlanTrip(userId);
    await setLocationProvider(userId, "travtrack");
    for (const [t, lat, lon] of driveNear(SALZBURG, noon(3)))
      await storePoint(userId, { t, lat, lon });
    const route = await getActualRoute(userId, tripId);
    expect(route).toMatchObject({ origin: "travtrack" });
    expect(route!.positions.every((p) => viennaDay(p.atMs) === "2026-10-03")).toBe(true);
  });

  it("TravTrack off: TravTrack is simply not a source", async () => {
    const { tripId } = await makePlanTrip(userId);
    await setLocationProvider(userId, "travtrack");
    for (const [t, lat, lon] of driveNear(SALZBURG, noon(3)))
      await storePoint(userId, { t, lat, lon });
    await switches.set({ beta: true, config: false });
    expect(await getActualRoute(userId, tripId)).toBeNull();
  });

  it("Dawarich users get it too, read for the trip's window", async () => {
    const { tripId } = await makePlanTrip(userId);
    await prisma.userSettings.create({
      data: {
        userId,
        data: {},
        dawarichBaseUrl: "http://dawarich.local:3000",
        dawarichApiKey: encryptApiKey("own"),
      },
    });
    await setLocationProvider(userId, "dawarich");
    const fixes = driveNear(VIENNA, noon(4));
    getPoints.mockImplementation(async ({ startAt, endAt }: { startAt: Date; endAt: Date }) => ({
      points: fixes
        .filter(([t]) => t >= startAt.getTime() && t <= endAt.getTime())
        .map(([t, lat, lon]) => ({
          id: t,
          latitude: lat,
          longitude: lon,
          timestampMs: t,
          altitude: null,
          accuracy: 9,
          velocity: null,
          trackId: null,
        })),
      truncated: false,
    }));
    const route = await getActualRoute(userId, tripId);
    expect(route).toMatchObject({ origin: "dawarich", coverage: "complete" });
    expect(route!.positions.length).toBeGreaterThan(0);
    expect(route!.positions.every((p) => viennaDay(p.atMs) === "2026-10-04")).toBe(true);
  });

  it("a privacy zone: no position or vertex inside it, and its day holds no data", async () => {
    const { tripId } = await makePlanTrip(userId);
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", ...SALZBURG, radiusM: 2000 },
    });
    await ownRecording(userId, tripId, [
      ...driveNear(MUNICH, noon(1)),
      ...driveNear(SALZBURG, noon(3)),
    ]);
    const route = await getActualRoute(userId, tripId);
    const inZone = (p: { lat: number; lon: number }) => distanceM(p, SALZBURG) <= 2000;
    expect(route!.positions.some(inZone)).toBe(false);
    expect(route!.segments.flat().some(([lon, lat]) => inZone({ lat, lon }))).toBe(false);
    expect(route!.days.find((d) => d.day === "2026-10-03")!.state).toBe("noData");
  });

  it("a gap, a privacy cut or a flight starts a new stretch", async () => {
    const { tripId } = await makePlanTrip(userId);
    // A flight on the 2nd, 12:00–12:20Z; its recorder window (±30 min) is the break.
    await prisma.flight.create({
      data: {
        userId,
        tripId,
        depIata: "MUC",
        arrIata: "SZG",
        depLat: MUNICH.lat,
        depLon: MUNICH.lon,
        arrLat: SALZBURG.lat,
        arrLon: SALZBURG.lon,
        departureTime: new Date("2026-10-02T12:00:00Z"),
        arrivalTime: new Date("2026-10-02T12:20:00Z"),
        status: "flown",
      },
    });
    const before = driveNear(MUNICH, Date.parse("2026-10-02T11:00:00Z"));
    // 20 km on, under 2 h later: no gap by distance or by time alone — but the flight lies between.
    const after = driveNear(
      { lat: MUNICH.lat + 0.18, lon: MUNICH.lon },
      Date.parse("2026-10-02T13:00:00Z")
    );
    await ownRecording(userId, tripId, [...before, ...after]);
    const route = await getActualRoute(userId, tripId);
    const stretchOf = (t: number) => route!.positions.find((p) => p.atMs === t)?.stretch;
    expect(stretchOf(before[0][0])).toBeDefined();
    expect(stretchOf(after[after.length - 1][0])).toBeDefined();
    expect(stretchOf(before[0][0])).not.toBe(stretchOf(after[after.length - 1][0]));
  });

  it("stays: an over lodging stay per day and a visit that happened; a future one is not a stay", async () => {
    const { tripId } = await makePlanTrip(userId);
    await ownRecording(userId, tripId, driveNear(MUNICH, noon(1)));
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Sacher", ...VIENNA },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        tripId,
        lodgingId: lodging.id,
        checkIn: new Date("2026-10-04T00:00:00Z"),
        checkOut: new Date("2026-10-06T00:00:00Z"),
        checkInDate: new Date("2026-10-04T00:00:00Z"),
        checkOutDate: new Date("2026-10-06T00:00:00Z"),
        status: "completed",
      },
    });
    const future = await prisma.lodging.create({ data: { userId, name: "Later", ...SALZBURG } });
    await prisma.lodgingStay.create({
      data: {
        userId,
        tripId,
        lodgingId: future.id,
        checkIn: new Date("2099-10-04T00:00:00Z"),
        checkOut: new Date("2099-10-06T00:00:00Z"),
        checkInDate: new Date("2099-10-04T00:00:00Z"),
        checkOutDate: new Date("2099-10-06T00:00:00Z"),
        status: "scheduled",
      },
    });
    const place = await prisma.place.create({ data: { userId, name: "Festung", ...SALZBURG } });
    await prisma.placeVisit.create({
      data: {
        userId,
        tripId,
        placeId: place.id,
        visitedAt: new Date("2026-10-03T14:00:00Z"),
        visitedAtUtc: new Date("2026-10-03T12:00:00Z"),
        visitedZone: "Europe/Vienna",
      },
    });
    const route = await getActualRoute(userId, tripId);
    expect(route!.stays.find((s) => s.kind === "place")!.atMs).toBe(
      Date.parse("2026-10-03T12:00:00Z")
    );
    expect(route!.stays.map((s) => [s.kind, s.label, s.day])).toEqual([
      ["lodging", "Hotel Sacher", "2026-10-04"],
      ["lodging", "Hotel Sacher", "2026-10-05"],
      ["lodging", "Hotel Sacher", "2026-10-06"],
      ["place", "Festung", "2026-10-03"],
    ]);
  });

  it("no track → null; another user's trip → null", async () => {
    const { tripId } = await makePlanTrip(userId);
    expect(await getActualRoute(userId, tripId)).toBeNull();
    await ownRecording(userId, tripId, driveNear(MUNICH, noon(1)));
    expect(await getActualRoute(stranger, tripId)).toBeNull();
  });
});
