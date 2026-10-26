import { prisma } from "../../../db";
import { encryptApiKey } from "../../../utils/encryption";
import { entryTrack, entryTrackLimits, flightEntryTrack, tripEntryTrack } from "../entryTrack";
import { setLocationProvider } from "../provider";
import { travTrackSwitches } from "../../travtrack/__tests__/switches";
import { pointsByDevice, rawSegments } from "../../tripRecording/segments";
import {
  makeFlight,
  makeTrip,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../travtrack/__tests__/fixtures";

const getPoints = jest.fn();
jest.mock("../../dawarich/dawarichClient", () => ({
  ...jest.requireActual("../../dawarich/dawarichClient"),
  createDawarichClient: () => ({ getPoints, checkHealth: jest.fn() }),
}));

/**
 * Where an entry's track comes from (TravTrack plan T5): the own recording by
 * default whatever the provider, else the provider — TravTrack's linked and
 * window points, or Dawarich's window — with the coverage said and the other
 * sources offered.
 */

const PREFIX = "travtrack-entry-";
// The trip fixture runs 11–14 Oct 2026 on Seoul's clock; the flight 00:30–01:30Z on the 12th.
const DAY = Date.parse("2026-10-12T00:00:00Z");
const HOUR = 3_600_000;

const remote = (tMs: number, lat = 37.5) => ({
  id: tMs,
  latitude: lat,
  longitude: 127,
  timestampMs: tMs,
  altitude: null,
  accuracy: 9,
  velocity: null,
  trackId: null,
});

describe("entryTrack", () => {
  const switches = travTrackSwitches();
  let userId: string;

  const ownDawarich = () =>
    prisma.userSettings.upsert({
      where: { userId },
      create: {
        userId,
        data: {},
        dawarichBaseUrl: "http://dawarich.local:3000",
        dawarichApiKey: encryptApiKey("own"),
      },
      update: {
        dawarichBaseUrl: "http://dawarich.local:3000",
        dawarichApiKey: encryptApiKey("own"),
      },
    });
  const ownBatch = (tripId: string) =>
    prisma.tripRecordingBatch.create({
      data: {
        userId,
        tripId,
        deviceId: "phone-old",
        uploadId: `own-${tripId}`,
        startedAt: new Date(DAY + 5 * HOUR),
        endedAt: new Date(DAY + 6 * HOUR),
        points: [
          [DAY + 5 * HOUR, 37.5, 127, 5],
          [DAY + 6 * HOUR, 37.51, 127, 5],
        ],
        pointCount: 2,
      },
    });
  const tripOf = (id: string) =>
    prisma.trip.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        startDay: true,
        endDay: true,
        startZone: true,
        endZone: true,
      },
    });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    getPoints.mockReset();
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("an own recording stays the default after a switch to dawarich, labelled travstats", async () => {
    const tripId = await makeTrip(userId);
    await ownBatch(tripId);
    await ownDawarich();
    await setLocationProvider(userId, "dawarich");

    const track = await tripEntryTrack(userId, await tripOf(tripId));
    expect(track).toMatchObject({
      origin: "travstats",
      coverage: "complete",
      alternatives: ["dawarich"],
    });
    expect(track.batches).toHaveLength(1);
    expect(getPoints).not.toHaveBeenCalled();
  });

  it("no own recording and provider dawarich → the window from Dawarich, coverage carried", async () => {
    const tripId = await makeTrip(userId);
    await ownDawarich();
    await setLocationProvider(userId, "dawarich");
    getPoints.mockResolvedValue({ points: [remote(DAY + 5 * HOUR)], truncated: true });

    const track = await entryTrack(userId, { kind: "trip", id: tripId });
    expect(track).toMatchObject({ origin: "dawarich", coverage: "truncated", alternatives: [] });
    expect(track.devices).toEqual([
      expect.objectContaining({
        deviceId: null,
        points: [expect.objectContaining({ atMs: DAY + 5 * HOUR })],
      }),
    ]);
    expect(getPoints).toHaveBeenCalledWith({
      startAt: new Date("2026-10-10T15:00:00Z"),
      endAt: new Date(Date.parse("2026-10-14T15:00:00Z") - 1),
    });
  });

  it("no own recording and provider travtrack → linked and window points, once each", async () => {
    const tripId = await makeTrip(userId);
    await setLocationProvider(userId, "travtrack");
    await storePoint(userId, {
      t: DAY + 5 * HOUR,
      lat: 37.5,
      lon: 127,
      links: [{ kind: "trip", id: tripId }],
    });
    await storePoint(userId, { t: DAY + 6 * HOUR, lat: 37.6, lon: 127 });
    // Linked but outside the trip's days: still the trip's.
    await storePoint(userId, {
      t: DAY + 5 * 24 * HOUR,
      lat: 37.7,
      lon: 127,
      links: [{ kind: "trip", id: tripId }],
    });

    const track = await entryTrack(userId, { kind: "trip", id: tripId });
    expect(track.origin).toBe("travtrack");
    expect(track.devices.flatMap((d) => d.points.map((p) => p.atMs))).toEqual([
      DAY + 5 * HOUR,
      DAY + 6 * HOUR,
      DAY + 5 * 24 * HOUR,
    ]);
  });

  it("choosing the source reads no recording: an own trip recording loads no TravTrack point (RC review)", async () => {
    const tripId = await makeTrip(userId);
    await ownBatch(tripId);
    await setLocationProvider(userId, "travtrack");
    for (let i = 0; i < 5; i++) {
      await storePoint(userId, {
        t: DAY + (5 + i / 10) * HOUR,
        lat: 37.5,
        lon: 127,
        links: [{ kind: "trip", id: tripId }],
      });
    }
    const spy = jest.spyOn(prisma.travTrackPoint, "findMany");
    try {
      const track = await tripEntryTrack(userId, await tripOf(tripId));
      expect(track.origin).toBe("travstats");
      expect(track.alternatives).toContain("travtrack");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("a TravTrack trip track is bounded and says truncated past the cap, never complete (RC review)", async () => {
    const tripId = await makeTrip(userId);
    await setLocationProvider(userId, "travtrack");
    for (let i = 0; i < 6; i++) {
      await storePoint(userId, {
        t: DAY + (5 + i / 10) * HOUR,
        lat: 37.5 + i / 1000,
        lon: 127,
        links: [{ kind: "trip", id: tripId }],
      });
    }
    const before = entryTrackLimits.points;
    entryTrackLimits.points = 4;
    try {
      const track = await entryTrack(userId, { kind: "trip", id: tripId });
      expect(track.origin).toBe("travtrack");
      expect(track.coverage).toBe("truncated");
      expect(track.devices.flatMap((d) => d.points).length).toBeLessThanOrEqual(4);
    } finally {
      entryTrackLimits.points = before;
    }
  });

  it("a fix linked to a delayed flight outside its scheduled window still shows", async () => {
    const flightId = await makeFlight(userId);
    await setLocationProvider(userId, "travtrack");
    const late = DAY + 6 * HOUR; // the window ends 02:00Z
    await storePoint(userId, {
      t: late,
      lat: 35,
      lon: 126.5,
      links: [{ kind: "flight", id: flightId }],
    });
    await storePoint(userId, { t: DAY + HOUR, lat: 36, lon: 126.5 }); // in the window
    await storePoint(userId, { t: DAY + 8 * HOUR, lat: 34, lon: 126.5 }); // neither

    const track = await entryTrack(userId, { kind: "flight", id: flightId });
    expect(track.origin).toBe("travtrack");
    expect(track.devices.flatMap((d) => d.points.map((p) => p.atMs))).toEqual([DAY + HOUR, late]);
  });

  it("the trip track keeps the flight window as a break", async () => {
    const tripId = await makeTrip(userId);
    const flightId = await makeFlight(userId);
    await prisma.flight.update({ where: { id: flightId }, data: { tripId } });
    await setLocationProvider(userId, "travtrack");
    await storePoint(userId, { t: DAY - HOUR, lat: 37.5, lon: 127 });
    await storePoint(userId, { t: DAY + HOUR, lat: 36, lon: 126.6 }); // in flight
    await storePoint(userId, { t: DAY + 3 * HOUR, lat: 33.5, lon: 126.5 });

    const track = await entryTrack(userId, { kind: "trip", id: tripId });
    expect(track.devices.flatMap((d) => d.points.map((p) => p.atMs))).toEqual([
      DAY - HOUR,
      DAY + 3 * HOUR,
    ]);
  });

  it("the trip track breaks at a deleted range and at a pause the phone reported, never across", async () => {
    const tripId = await makeTrip(userId);
    await setLocationProvider(userId, "travtrack");
    const MIN = 60_000;
    // Two pairs of close fixes (minutes and metres apart), each straddling a break.
    await storePoint(userId, { t: DAY + 5 * HOUR, lat: 37.5, lon: 127, device: "phone-a" });
    await storePoint(userId, {
      t: DAY + 5 * HOUR + 20 * MIN,
      lat: 37.501,
      lon: 127,
      device: "phone-a",
    });
    await storePoint(userId, { t: DAY + 7 * HOUR, lat: 37.502, lon: 127, device: "phone-a" });
    await storePoint(userId, {
      t: DAY + 7 * HOUR + 20 * MIN,
      lat: 37.503,
      lon: 127,
      device: "phone-a",
    });
    await storePoint(userId, { t: DAY + 7 * HOUR, lat: 37.6, lon: 127, device: "phone-b" });
    await storePoint(userId, {
      t: DAY + 7 * HOUR + 20 * MIN,
      lat: 37.601,
      lon: 127,
      device: "phone-b",
    });
    await prisma.travTrackDeletedRange.create({
      data: {
        userId,
        fromAt: new Date(DAY + 5 * HOUR + 5 * MIN),
        toAt: new Date(DAY + 5 * HOUR + 15 * MIN),
      },
    });
    await prisma.travTrackGap.create({
      data: {
        userId,
        deviceId: "phone-a",
        fromAt: new Date(DAY + 7 * HOUR + 5 * MIN),
        toAt: new Date(DAY + 7 * HOUR + 15 * MIN),
        reason: "recorderSilent",
      },
    });

    const track = await tripEntryTrack(userId, await tripOf(tripId));
    const segments = rawSegments(pointsByDevice(track.batches, "UTC")).map((s) =>
      s.map((p) => p[0])
    );
    expect(segments).toEqual(
      expect.arrayContaining([
        [DAY + 5 * HOUR],
        [DAY + 5 * HOUR + 20 * MIN, DAY + 7 * HOUR],
        [DAY + 7 * HOUR + 20 * MIN],
        // phone-a's pause says nothing about phone-b.
        [DAY + 7 * HOUR, DAY + 7 * HOUR + 20 * MIN],
      ])
    );
    expect(segments).toHaveLength(4);
  });

  it("?source=dawarich on an entry with an own recording shows Dawarich and says so", async () => {
    const tripId = await makeTrip(userId);
    await ownBatch(tripId);
    await ownDawarich();
    await setLocationProvider(userId, "dawarich");
    getPoints.mockResolvedValue({ points: [remote(DAY + 9 * HOUR)], truncated: false });

    const track = await entryTrack(userId, { kind: "trip", id: tripId }, { source: "dawarich" });
    expect(track).toMatchObject({
      origin: "dawarich",
      coverage: "complete",
      alternatives: ["travstats"],
    });
  });

  it("Dawarich offered beside an own recording is named as not checked yet, and is not read", async () => {
    const tripId = await makeTrip(userId);
    await ownBatch(tripId);
    await ownDawarich();
    await setLocationProvider(userId, "dawarich");

    const track = await entryTrack(userId, { kind: "trip", id: tripId });
    expect(track).toMatchObject({
      origin: "travstats",
      alternatives: ["dawarich"],
      unchecked: ["dawarich"],
    });
    expect(getPoints).not.toHaveBeenCalled();
    // Once read, it is no longer unchecked; what it was read beside is.
    getPoints.mockResolvedValue({ points: [remote(DAY + 9 * HOUR)], truncated: false });
    const asked = await entryTrack(userId, { kind: "trip", id: tripId }, { source: "dawarich" });
    expect(asked).toMatchObject({ alternatives: ["travstats"], unchecked: [] });
  });

  it("a Dawarich timeout answers coverage unreachable with the own recording untouched", async () => {
    const tripId = await makeTrip(userId);
    await ownBatch(tripId);
    await ownDawarich();
    await setLocationProvider(userId, "dawarich");
    getPoints.mockRejectedValue(new Error("timeout"));

    const asked = await entryTrack(userId, { kind: "trip", id: tripId }, { source: "dawarich" });
    expect(asked).toMatchObject({ origin: "dawarich", coverage: "unreachable", devices: [] });
    expect(await prisma.tripRecordingBatch.count({ where: { tripId } })).toBe(1);
    expect((await entryTrack(userId, { kind: "trip", id: tripId })).origin).toBe("travstats");
  });

  it("a source that holds nothing is 404 TRACK_SOURCE_NOT_AVAILABLE", async () => {
    const tripId = await makeTrip(userId);
    await expect(
      entryTrack(userId, { kind: "trip", id: tripId }, { source: "travstats" })
    ).rejects.toMatchObject({ statusCode: 404, code: "TRACK_SOURCE_NOT_AVAILABLE" });
    await expect(
      entryTrack(userId, { kind: "trip", id: tripId }, { source: "dawarich" })
    ).rejects.toMatchObject({ code: "TRACK_SOURCE_NOT_AVAILABLE" });
    // An empty Dawarich window is nothing either.
    await ownDawarich();
    await setLocationProvider(userId, "dawarich");
    getPoints.mockResolvedValue({ points: [], truncated: false });
    await expect(
      entryTrack(userId, { kind: "trip", id: tripId }, { source: "dawarich" })
    ).rejects.toMatchObject({ code: "TRACK_SOURCE_NOT_AVAILABLE" });
  });

  it("TravTrack points are offered while the instance is on, and the default under travtrack", async () => {
    const flightId = await makeFlight(userId);
    await storePoint(userId, {
      t: DAY + HOUR,
      lat: 36,
      lon: 126.5,
      links: [{ kind: "flight", id: flightId }],
    });
    const flight = await prisma.flight.findUniqueOrThrow({ where: { id: flightId } });
    // Provider none: nothing is the default, TravTrack is offered.
    expect(await flightEntryTrack(userId, flight)).toMatchObject({
      origin: null,
      alternatives: ["travtrack"],
    });
    await setLocationProvider(userId, "travtrack");
    expect((await flightEntryTrack(userId, flight)).origin).toBe("travtrack");
    await switches.set({ beta: true, config: false });
    expect((await flightEntryTrack(userId, flight)).origin).toBeNull();
  });
});
