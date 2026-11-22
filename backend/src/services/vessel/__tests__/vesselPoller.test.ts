jest.mock("../../ferry/aisStream", () => ({
  ...jest.requireActual("../../ferry/aisStream"),
  aisConfigured: jest.fn(() => true),
  lookupVessel: jest.fn(),
}));
jest.mock("../vesselResolver", () => ({
  ...jest.requireActual("../vesselResolver"),
  resolveVessel: jest.fn(),
}));
import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { generateToken } from "../../../utils/jwt";
import { hashPassword } from "../../../utils/password";
import { aisConfigured, type AisResult } from "../../ferry/aisStream";
import { resolveVessel } from "../vesselResolver";
import { pollVesselsOnce } from "../vesselPoller";

const NOW = new Date("2030-06-01T12:00:00Z");
const DEP = { lat: 54.38, lon: 10.17 }; // Kiel
const ARR = { lat: 57.7, lon: 11.95 }; // Gothenburg
const MANUAL_LINE = [
  [DEP.lon, DEP.lat],
  [11, 56],
  [ARR.lon, ARR.lat],
];

const ok = (lat: number, lon: number, at: Date): AisResult => ({
  status: "ok",
  position: {
    mmsi: "265177000",
    vesselName: "STENA GERMANICA",
    lat,
    lon,
    speedKnots: 18,
    courseDegrees: 10,
    receivedAt: at.toISOString(),
    observedAt: at.toISOString(),
  },
});

let userId: string;
let cookie: string;

async function ferry(departure: Date, arrival: Date) {
  return prisma.ferryJourney.create({
    data: {
      userId,
      operator: "Stena Line",
      vesselName: "Stena Germanica",
      depStationName: "Kiel",
      depLat: DEP.lat,
      depLon: DEP.lon,
      arrStationName: "Göteborg",
      arrLat: ARR.lat,
      arrLon: ARR.lon,
      departureTime: departure,
      arrivalTime: arrival,
      geometry: MANUAL_LINE,
      geometrySource: "manual",
      distanceKm: 420,
      distanceSource: "sea_route",
    },
  });
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: "vesselpoller" } });
  const user = await prisma.user.create({
    data: { username: "vesselpoller", passwordHash: await hashPassword("password123") },
  });
  userId = user.id;
  cookie = `auth_token=${generateToken(user.id)}`;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: "vesselpoller" } });
});
beforeEach(async () => {
  await prisma.ferryJourney.deleteMany({ where: { userId } });
  await prisma.cruise.deleteMany({ where: { userId } });
  jest.mocked(aisConfigured).mockReturnValue(true);
  jest.mocked(resolveVessel).mockReset().mockResolvedValue({
    status: "resolved",
    mmsi: "265177000",
    imo: "9145176",
    source: "wikidata",
    confidence: "high",
  });
});

describe("vessel poller", () => {
  it("stores positions only while the crossing is in progress", async () => {
    const live = await ferry(
      new Date(NOW.getTime() - 3600e3),
      new Date(NOW.getTime() + 8 * 3600e3)
    );
    const past = await ferry(new Date("2030-05-01T08:00:00Z"), new Date("2030-05-01T20:00:00Z"));
    const later = await ferry(new Date("2030-06-10T08:00:00Z"), new Date("2030-06-10T20:00:00Z"));
    // Departed this morning, arrived hours ago: inside the query window, no longer at sea.
    await ferry(new Date(NOW.getTime() - 20 * 3600e3), new Date(NOW.getTime() - 10 * 3600e3));
    const read = jest.fn(async () => ok(55, 10.8, NOW));
    const report = await pollVesselsOnce(NOW, read);
    expect(report.stored).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
    const fixes = await prisma.vesselPositionFix.findMany({ where: { userId } });
    expect(fixes.map((f) => f.ferryJourneyId)).toEqual([live.id]);
    expect(past.id).not.toBe(later.id);
    // Bound on the resolver's answer, with its source.
    const row = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: live.id } });
    expect(row).toMatchObject({ vesselMmsi: "265177000", vesselMmsiSource: "wikidata" });
  });

  it("deduplicates a position it already has", async () => {
    await ferry(new Date(NOW.getTime() - 3600e3), new Date(NOW.getTime() + 8 * 3600e3));
    const read = jest.fn(async () => ok(55, 10.8, NOW));
    await pollVesselsOnce(NOW, read);
    await pollVesselsOnce(new Date(NOW.getTime() + 60e3), read);
    expect(await prisma.vesselPositionFix.count({ where: { userId } })).toBe(1);
  });

  it("never replaces a hand-drawn route; a covering track only sets the distance", async () => {
    const ride = await ferry(
      new Date(NOW.getTime() - 3600e3),
      new Date(NOW.getTime() + 8 * 3600e3)
    );
    // A position every 30 minutes from Kiel to Gothenburg: a track without holes.
    for (let i = 0; i <= 12; i++) {
      const at = new Date(NOW.getTime() + i * 30 * 60e3);
      const f = i / 12;
      await pollVesselsOnce(at, async () =>
        ok(DEP.lat + (ARR.lat - DEP.lat) * f, DEP.lon + (ARR.lon - DEP.lon) * f, at)
      );
    }
    const row = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } });
    expect(row.geometrySource).toBe("manual");
    expect(row.geometry).toEqual(MANUAL_LINE);
    expect(row.distanceSource).toBe("ais_track");
    expect(row.distanceKm).toBeGreaterThan(300);
  });

  it("does not let a track with a hole set the distance", async () => {
    const ride = await ferry(
      new Date(NOW.getTime() - 3600e3),
      new Date(NOW.getTime() + 8 * 3600e3)
    );
    await pollVesselsOnce(NOW, async () => ok(DEP.lat, DEP.lon, NOW));
    const later = new Date(NOW.getTime() + 6 * 3600e3);
    await pollVesselsOnce(later, async () => ok(ARR.lat, ARR.lon, later));
    const row = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } });
    expect(row).toMatchObject({ distanceSource: "sea_route", distanceKm: 420 });
  });

  it("stores nothing and resolves nothing without an AIS key", async () => {
    jest.mocked(aisConfigured).mockReturnValue(false);
    await ferry(new Date(NOW.getTime() - 3600e3), new Date(NOW.getTime() + 8 * 3600e3));
    const read = jest.fn();
    expect(await pollVesselsOnce(NOW, read)).toMatchObject({ skipped: "notConfigured" });
    expect(read).not.toHaveBeenCalled();
    expect(resolveVessel).not.toHaveBeenCalled();
  });

  it("keeps an unresolved ship unresolved: no read, no fix", async () => {
    jest
      .mocked(resolveVessel)
      .mockResolvedValue({ status: "unresolved", reason: "ambiguous", candidates: [] });
    await ferry(new Date(NOW.getTime() - 3600e3), new Date(NOW.getTime() + 8 * 3600e3));
    const read = jest.fn();
    expect(await pollVesselsOnce(NOW, read)).toMatchObject({ unresolved: 1, stored: 0 });
    expect(read).not.toHaveBeenCalled();
  });

  it("turns a cruise's positions into its recorded AIS track", async () => {
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        shipNameOverride: "Stena Germanica",
        startDate: new Date("2030-05-30T00:00:00Z"),
        endDate: new Date("2030-06-03T00:00:00Z"),
        status: "in_progress",
      },
    });
    await pollVesselsOnce(NOW, async () => ok(55, 10.8, NOW));
    const later = new Date(NOW.getTime() + 3600e3);
    await pollVesselsOnce(later, async () => ok(55.3, 11, later));
    const tracks = await prisma.cruiseTrack.findMany({ where: { cruiseId: cruise.id } });
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ source: "ais", externalRef: "ais", pointCount: 2 });
  });
});

describe("GET /:id/vessel", () => {
  it("says the ship is out of AIS range when no position came in during the voyage", async () => {
    const now = new Date();
    const ride = await ferry(
      new Date(now.getTime() - 3600e3),
      new Date(now.getTime() + 8 * 3600e3)
    );
    const res = await request(app).get(`/api/v1/ferry/${ride.id}/vessel`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      mmsi: "265177000",
      source: "wikidata",
      inProgress: true,
      signal: "outOfRange",
      lastFix: null,
    });
  });

  it("names the reason when the ship cannot be found unambiguously", async () => {
    jest
      .mocked(resolveVessel)
      .mockResolvedValue({ status: "unresolved", reason: "ambiguous", candidates: [] });
    const ride = await ferry(new Date("2030-05-01T08:00:00Z"), new Date("2030-05-01T20:00:00Z"));
    const res = await request(app).get(`/api/v1/ferry/${ride.id}/vessel`).set("Cookie", cookie);
    expect(res.body.data).toMatchObject({ mmsi: null, signal: "unresolved", reason: "ambiguous" });
  });

  it("refuses to bind an MMSI the server never offered", async () => {
    const ride = await ferry(new Date("2030-05-01T08:00:00Z"), new Date("2030-05-01T20:00:00Z"));
    const res = await request(app)
      .put(`/api/v1/ferry/${ride.id}/vessel`)
      .set("Cookie", cookie)
      .send({ mmsi: "211123456", query: "Stena" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VESSEL_NOT_OFFERED");
    const row = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } });
    expect(row.vesselMmsi).toBeNull();
  });
});

describe("Schiff zuordnen", () => {
  it("keeps the recorded positions when the same ship is picked again", async () => {
    const ride = await ferry(
      new Date(NOW.getTime() - 3600e3),
      new Date(NOW.getTime() + 8 * 3600e3)
    );
    await pollVesselsOnce(NOW, async () => ok(55, 10.8, NOW));
    await prisma.vesselIdentity.upsert({
      where: { lookupKey: "search:stena" },
      create: {
        lookupKey: "search:stena",
        candidates: [
          {
            mmsi: "265177000",
            imo: null,
            name: "Stena Germanica",
            operator: null,
            source: "wikidata",
          },
        ],
        resolvedAt: NOW,
        nextAttemptAt: new Date(Date.now() + 3600e3),
      },
      update: {},
    });
    await request(app)
      .put(`/api/v1/ferry/${ride.id}/vessel`)
      .set("Cookie", cookie)
      .send({ mmsi: "265177000", query: "Stena" })
      .expect(200);
    const row = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } });
    expect(row.vesselMmsiSource).toBe("manual");
    expect(await prisma.vesselPositionFix.count({ where: { ferryJourneyId: ride.id } })).toBe(1);
    await prisma.vesselIdentity.delete({ where: { lookupKey: "search:stena" } });
  });
});
