import { prisma } from "../../../db";
import * as bounds from "../../tripRecording/bounds";
import { lastSeen } from "../lastSeen";
import { makeFlight, makeUser, storePoint, wipeTravTrack } from "./fixtures";

/**
 * „Zuletzt gesehen" (TravTrack plan L2): the newest stored position of the
 * account that is a real fix — never an anomaly, never one inside a privacy
 * zone or a deleted span, even if such a row exists (ingest drops them; this
 * read does not rely on it), and never another account's.
 */

const PREFIX = "travtrack-lastseen-";
const MIN = 60_000;
const T0 = Date.parse("2026-10-12T03:00:00Z");
const SEOUL = { lat: 37.5665, lon: 126.978 };
const TOKYO = { lat: 35.6762, lon: 139.6503 };

describe("TravTrack — last seen", () => {
  let userId: string;
  let otherId: string;

  /** A quiet walk around Seoul City Hall, one fix a minute from T0. */
  const walk = async (count: number, device = "phone-1", from = T0) => {
    for (let i = 0; i < count; i++) {
      await storePoint(userId, {
        t: from + i * MIN,
        lat: SEOUL.lat + i * 0.0001,
        lon: SEOUL.lon,
        device,
      });
    }
  };

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
  });

  beforeEach(async () => {
    await wipeTravTrack([userId, otherId]);
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.apiToken.deleteMany({ where: { userId } });
    await prisma.travTrackImport.deleteMany({ where: { userId } });
    await prisma.travTrackIngestToken.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("no points → null", async () => {
    await storePoint(otherId, { t: T0, ...SEOUL });
    expect(await lastSeen(userId)).toBeNull();
  });

  it("the newest point with its device", async () => {
    await walk(6, "phone-1");
    await storePoint(userId, { t: T0 + 10 * MIN, lat: 37.57, lon: 126.98, device: "phone-2" });
    // Another account's newer fix is never read.
    await storePoint(otherId, { t: T0 + 20 * MIN, ...TOKYO });
    const seen = await lastSeen(userId);
    expect(seen).toMatchObject({
      atMs: T0 + 10 * MIN,
      lat: 37.57,
      lon: 126.98,
      accuracyM: 5,
      deviceId: "phone-2",
      origin: "companion:phone-2",
    });
  });

  it("a masked teleport is not the last seen", async () => {
    await walk(6);
    // One fix in Tokyo a minute later, then back: a stale fix the phone handed over.
    await storePoint(userId, { t: T0 + 6 * MIN, ...TOKYO });
    await storePoint(userId, { t: T0 + 7 * MIN, ...SEOUL });
    expect((await lastSeen(userId))?.atMs).toBe(T0 + 7 * MIN);
    expect((await lastSeen(userId))?.lat).toBe(SEOUL.lat);
  });

  it("a teleport with no return yet is held back, not shown", async () => {
    await walk(6);
    await storePoint(userId, { t: T0 + 6 * MIN, ...TOKYO });
    expect((await lastSeen(userId))?.atMs).toBe(T0 + 5 * MIN);
  });

  it("a fast step inside a flight's window is a flight, not a teleport", async () => {
    await makeFlight(userId); // ICN → CJU, 00:30Z–01:30Z on 12 Oct
    const dep = Date.parse("2026-10-12T00:40:00Z");
    for (let i = 0; i < 3; i++) {
      await storePoint(userId, { t: dep + i * MIN, lat: 37.469, lon: 126.451 });
    }
    await storePoint(userId, { t: dep + 10 * MIN, lat: 33.511, lon: 126.493 });
    expect((await lastSeen(userId))?.atMs).toBe(dep + 10 * MIN);
  });

  it("a long flight history is not read: only the flights near the points are", async () => {
    // Sixty flights years before the history, and one inside it.
    await prisma.flight.createMany({
      data: Array.from({ length: 60 }, (_, i) => {
        const dep = Date.parse("2019-01-01T08:00:00Z") + i * 86_400_000;
        return {
          userId,
          depIata: "MUC",
          arrIata: "BER",
          depLat: 48.354,
          depLon: 11.786,
          arrLat: 52.366,
          arrLon: 13.503,
          departureTime: new Date(dep),
          arrivalTime: new Date(dep + 3_600_000),
          status: "flown",
        };
      }),
    });
    await makeFlight(userId); // 00:30Z–01:30Z on 12 Oct, beside the points
    const dep = Date.parse("2026-10-12T00:40:00Z");
    for (let i = 0; i < 3; i++) {
      await storePoint(userId, { t: dep + i * MIN, lat: 37.469, lon: 126.451 });
    }
    await storePoint(userId, { t: dep + 10 * MIN, lat: 33.511, lon: 126.493 });

    const resolve = jest.spyOn(bounds, "flightRecorderWindows");
    try {
      // The flight inside still makes the fast step a flight, not a teleport.
      expect((await lastSeen(userId))?.atMs).toBe(dep + 10 * MIN);
      const resolved = resolve.mock.calls.reduce((n, [flights]) => n + flights.length, 0);
      expect(resolved).toBe(1);
    } finally {
      resolve.mockRestore();
    }
  });

  it("a bad fix — 50 km accuracy, null island — is skipped", async () => {
    await walk(3);
    await storePoint(userId, { t: T0 + 3 * MIN, ...SEOUL, accuracyM: 50_000 });
    await storePoint(userId, { t: T0 + 4 * MIN, lat: 0, lon: 0 });
    expect((await lastSeen(userId))?.atMs).toBe(T0 + 2 * MIN);
  });

  it("a point inside a privacy zone is never the last seen, even if stored", async () => {
    await walk(3);
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Wohnung", lat: 37.6, lon: 126.98, radiusM: 500 },
    });
    await storePoint(userId, { t: T0 + 3 * MIN, lat: 37.6005, lon: 126.98 });
    expect((await lastSeen(userId))?.atMs).toBe(T0 + 2 * MIN);
  });

  it("a former zone hides what it covered, not what came after it", async () => {
    await walk(3);
    const circle = { lat: 37.6, lon: 126.98, radiusM: 500 };
    await prisma.travTrackZoneTombstone.create({
      data: { userId, ...circle, untilAt: new Date(T0 + 4 * MIN) },
    });
    await storePoint(userId, { t: T0 + 3 * MIN, lat: 37.6005, lon: 126.98 });
    expect((await lastSeen(userId))?.atMs).toBe(T0 + 2 * MIN);
    // Recorded after the zone went: the user records there on purpose.
    await storePoint(userId, { t: T0 + 5 * MIN, lat: 37.6005, lon: 126.98 });
    expect((await lastSeen(userId))?.atMs).toBe(T0 + 5 * MIN);
  });

  it("a point inside a deleted span is never the last seen, even if stored", async () => {
    await walk(3);
    await prisma.travTrackDeletedRange.create({
      data: { userId, fromAt: new Date(T0 + 3 * MIN), toAt: new Date(T0 + 10 * MIN) },
    });
    await storePoint(userId, { t: T0 + 3 * MIN, lat: 37.5669, lon: 126.978 });
    expect((await lastSeen(userId))?.atMs).toBe(T0 + 2 * MIN);
  });

  it("names the device: the paired phone, the file, the live source", async () => {
    await prisma.apiToken.create({
      data: {
        userId,
        label: "Pixel 9",
        lookupHash: `${PREFIX}lookup`,
        hash: "x",
        deviceId: "phone-1",
      },
    });
    await walk(2, "phone-1");
    expect((await lastSeen(userId))?.deviceLabel).toBe("Pixel 9");

    const file = await prisma.travTrackImport.create({
      data: { userId, kind: "gpx", fileName: "tour.gpx", status: "succeeded" },
    });
    await storePoint(userId, { t: T0 + 2 * MIN, ...SEOUL, device: `file:${file.id}` });
    expect((await lastSeen(userId))?.deviceLabel).toBe("tour.gpx");

    const token = await prisma.travTrackIngestToken.create({
      data: { userId, kind: "owntracks", label: "OwnTracks iPad", lookupHash: "l", hash: "h" },
    });
    await storePoint(userId, { t: T0 + 3 * MIN, ...SEOUL, device: `owntracks:${token.id}` });
    expect((await lastSeen(userId))?.deviceLabel).toBe("OwnTracks iPad");

    await storePoint(userId, { t: T0 + 4 * MIN, ...SEOUL, device: "phone-unknown" });
    expect((await lastSeen(userId))?.deviceLabel).toBeNull();
  });

  it("never names another account's device", async () => {
    await prisma.apiToken.create({
      data: { userId: otherId, label: "Fremd", lookupHash: `${PREFIX}o`, hash: "x", deviceId: "p" },
    });
    await storePoint(userId, { t: T0, ...SEOUL, device: "p" });
    expect((await lastSeen(userId))?.deviceLabel).toBeNull();
  });
});
