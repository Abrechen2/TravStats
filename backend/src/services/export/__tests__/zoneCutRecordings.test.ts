import { prisma } from "../../../db";
import { buildAccountExport } from "../allDataExport";
import { makeFlight, makeTrip, makeUser } from "../../travtrack/__tests__/fixtures";

/**
 * Owner decision 2026-10-26 (final Codex review P1): a privacy zone also cuts
 * the legacy recordings — a flight's `flight_tracks` line and a trip's
 * `trip_recording_batches` — when the account export (and so the WebDAV sync)
 * is written. The stored rows stay as they are.
 */

const PREFIX = "zone-cut-export-";
const HOME = { lat: 37.5, lon: 127.0 };
const T = Date.parse("2026-10-12T00:00:00Z");

describe("account export — legacy recordings cut by the privacy zones", () => {
  let userId: string;

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("a fix inside a zone leaves neither in a trip batch nor on a flight line; the stored rows keep it", async () => {
    const tripId = await makeTrip(userId);
    await prisma.tripRecordingBatch.create({
      data: {
        userId,
        tripId,
        deviceId: "phone",
        uploadId: `${PREFIX}batch`,
        startedAt: new Date(T),
        endedAt: new Date(T + 20 * 60_000),
        points: [
          [T, HOME.lat, HOME.lon, 10], // at home, inside the zone
          [T + 10 * 60_000, 37.6, 127.1, 10],
          [T + 20 * 60_000, 37.7, 127.2, 10],
        ],
        pointCount: 3,
      },
    });
    const flightId = await makeFlight(userId);
    await prisma.flightTrack.create({
      data: {
        flightId,
        source: "companion",
        uploadId: `${PREFIX}track`,
        startedAt: new Date(T),
        endedAt: new Date(T + 3_600_000),
        geometry: [
          [HOME.lon, HOME.lat],
          [127.3, 37.0],
          [127.5, 36.0],
        ],
        segmentStarts: [0],
        cumulativeKm: [0, 60, 170],
        pointCount: 3,
        distanceKm: 170,
      },
    });
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", lat: HOME.lat, lon: HOME.lon, radiusM: 500 },
    });

    const out = (await buildAccountExport(userId, "test")) as {
      user: {
        tripRecordingBatches: Array<{ points: number[][]; pointCount: number }>;
        flights: Array<{ track: { geometry: number[][]; pointCount: number } | null }>;
      };
    };

    const batch = out.user.tripRecordingBatches[0];
    expect(batch.points.some((p) => p[1] === HOME.lat && p[2] === HOME.lon)).toBe(false);
    expect(batch.pointCount).toBe(batch.points.length);
    const track = out.user.flights.find((f) => f.track)?.track;
    expect(track?.geometry.some((p) => p[0] === HOME.lon && p[1] === HOME.lat)).toBe(false);
    expect(track?.pointCount).toBe(track?.geometry.length);

    // Stored rows untouched.
    const stored = await prisma.tripRecordingBatch.findFirstOrThrow({ where: { userId } });
    expect((stored.points as number[][]).length).toBe(3);
    const storedTrack = await prisma.flightTrack.findFirstOrThrow({ where: { flightId } });
    expect((storedTrack.geometry as number[][]).length).toBe(3);
  });

  it("a batch wholly inside a zone is left out, not written as an empty upload", async () => {
    await prisma.tripRecordingBatch.deleteMany({ where: { userId } });
    const tripId = await makeTrip(userId, "Home");
    await prisma.tripRecordingBatch.create({
      data: {
        userId,
        tripId,
        deviceId: "phone",
        uploadId: `${PREFIX}inside`,
        startedAt: new Date(T),
        endedAt: new Date(T + 60_000),
        points: [
          [T, HOME.lat, HOME.lon, 10],
          [T + 60_000, HOME.lat + 0.0005, HOME.lon, 10],
        ],
        pointCount: 2,
      },
    });
    const out = (await buildAccountExport(userId, "test")) as {
      user: { tripRecordingBatches: unknown[] };
    };
    expect(out.user.tripRecordingBatches).toEqual([]);
  });
});
