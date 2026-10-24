import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { encryptApiKey } from "../../utils/encryption";
import { setLocationProvider } from "../../services/locationProvider/provider";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";

/**
 * `GET /api/v1/location/capabilities` (TravTrack plan, task S4): what the
 * Companion should record for this account. Phase 1 (sequencing rule): a
 * `dawarich` account keeps today's flight and trip recording until the flight
 * and trip pages read Dawarich tracks (T5); only `travtrack` turns them off.
 *
 * And the rule pinned here (review focus 2): the recording routes never
 * consult the provider. A recording queued on the phone under `none` and sent
 * after a switch to `dawarich` is still accepted.
 */

const USERNAME = `location-caps-${Date.now()}`;
const PATH = "/api/v1/location/capabilities";
const DEPARTURE = Date.parse("2026-10-03T08:00:00Z");

describe("location capabilities", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let cookie: string;

  const caps = () => request(app).get(PATH).set("Cookie", cookie).expect(200);

  async function settings(data: Record<string, unknown>): Promise<void> {
    await prisma.userSettings.upsert({
      where: { userId },
      create: { userId, data: {}, ...data },
      update: data,
    });
  }
  const ownDawarich = {
    dawarichBaseUrl: "http://dawarich.local:3000",
    dawarichApiKey: encryptApiKey("own-key"),
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    // The phase-1 cases below describe a server without TravTrack.
    await switches.set({ beta: false, config: false });
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("TravTrack: capture apart from upload (phase 2, T1)", () => {
    afterEach(async () => {
      await switches.set({ beta: false, config: false });
    });

    it("provider travtrack: both true with sink travtrack", async () => {
      await switches.set({ beta: true, config: true });
      await setLocationProvider(userId, "travtrack");
      expect((await caps()).body.capture).toEqual({
        flight: true,
        trip: true,
        everyday: true,
        modes: ["off", "trips", "everyday"],
        sink: "travtrack",
      });
    });

    it("provider travtrack on an instance that takes points: capture and upload", async () => {
      await switches.set({ beta: true, config: true });
      await setLocationProvider(userId, "travtrack");
      expect((await caps()).body.travTrack).toEqual({
        offered: true,
        enabled: true,
        capture: true,
        upload: true,
      });
    });

    it("travTrack.upload stays true after a switch to provider none while the instance takes points", async () => {
      await switches.set({ beta: true, config: true });
      await setLocationProvider(userId, "travtrack");
      await setLocationProvider(userId, "none");
      const body = (await caps()).body;
      expect(body.travTrack.upload).toBe(true);
      // travTrack.capture is false then.
      expect(body.travTrack.capture).toBe(false);
      expect(body.travTrack.enabled).toBe(false);
    });

    it("upload false once the admin switches TravTrack off", async () => {
      await switches.set({ beta: true, config: true });
      await setLocationProvider(userId, "travtrack");
      await switches.set({ beta: true, config: false });
      const body = (await caps()).body;
      expect(body.travTrack).toEqual({
        offered: false,
        enabled: false,
        capture: false,
        upload: false,
      });
      expect(body.provider).toMatchObject({ kind: "travtrack", status: "unavailable" });
    });
  });

  describe("shape for each provider", () => {
    it("none (no settings at all): flights and trips, nothing everyday", async () => {
      expect((await caps()).body).toEqual({
        version: 1,
        provider: { kind: "none", rev: 0, status: "ok" },
        capture: { flight: true, trip: true, everyday: false, modes: [], sink: "entries" },
        travTrack: { offered: false, enabled: false, capture: false, upload: false },
      });
    });

    it("none follows the account's own switches", async () => {
      await settings({ flightLiveTrackingEnabled: false, tripRecordingEnabled: false });
      expect((await caps()).body.capture).toEqual({
        flight: false,
        trip: false,
        everyday: false,
        modes: [],
        sink: null,
      });
    });

    it("provider dawarich: capture.flight and capture.trip false, sink null", async () => {
      await settings({ ...ownDawarich, locationProvider: "dawarich", locationProviderRev: 3 });
      expect((await caps()).body).toEqual({
        version: 1,
        provider: { kind: "dawarich", rev: 3, status: "ok" },
        capture: { flight: false, trip: false, everyday: false, modes: [], sink: null },
        travTrack: { offered: false, enabled: false, capture: false, upload: false },
      });
    });

    it("dawarich without its key reports notConfigured, not none", async () => {
      await settings({ locationProvider: "dawarich", locationProviderRev: 1 });
      expect((await caps()).body.provider).toEqual({
        kind: "dawarich",
        rev: 1,
        status: "notConfigured",
      });
    });

    it("travtrack that this server does not offer records nothing and says unavailable", async () => {
      await settings({ locationProvider: "travtrack", locationProviderRev: 2 });
      expect((await caps()).body).toEqual({
        version: 1,
        provider: { kind: "travtrack", rev: 2, status: "unavailable" },
        capture: { flight: false, trip: false, everyday: false, modes: [], sink: null },
        travTrack: { offered: false, enabled: false, capture: false, upload: false },
      });
    });
  });

  it("a read-only token may call it", async () => {
    const tok = await generateApiToken();
    await prisma.apiToken.create({
      data: {
        userId,
        label: "caps-read",
        lookupHash: tok.lookupHash,
        hash: tok.hash,
        scope: "read",
      },
    });
    const res = await request(app)
      .get(PATH)
      .set("Authorization", `Bearer ${tok.plaintext}`)
      .expect(200);
    expect(res.body.version).toBe(1);
    await prisma.apiToken.deleteMany({ where: { userId } });
  });

  it("answers 401 without a session", async () => {
    await request(app).get(PATH).expect(401);
  });

  describe("the recording routes never consult the provider", () => {
    beforeEach(async () => {
      await settings({ ...ownDawarich, locationProvider: "dawarich", locationProviderRev: 1 });
    });

    it("a trip recording uploaded while provider is dawarich is still accepted (201)", async () => {
      const trip = await prisma.trip.create({
        data: {
          userId,
          name: "Tokio",
          startDate: new Date("2026-05-01T00:00:00Z"),
          endDate: new Date("2026-05-03T00:00:00Z"),
          startDay: new Date("2026-05-01T00:00:00Z"),
          endDay: new Date("2026-05-03T00:00:00Z"),
          startZone: "Asia/Tokyo",
          endZone: "Asia/Tokyo",
        },
      });
      const res = await request(app)
        .post(`/api/v1/trips/${trip.id}/recording`)
        .set("Cookie", cookie)
        .send({
          uploadId: "queued-before-switch",
          points: [{ t: "2026-05-01T03:00:00Z", lat: 35.68, lon: 139.76, accuracy: 25 }],
        });
      expect(res.status).toBe(201);
      expect(res.body.accepted).toBe(1);
    });

    it("a flight track uploaded while provider is dawarich is still accepted", async () => {
      const flight = await prisma.flight.create({
        data: {
          userId,
          depIata: "MUC",
          arrIata: "ICN",
          depLat: 48.354,
          depLon: 11.786,
          arrLat: 37.469,
          arrLon: 126.451,
          flightNumber: "LH718",
          departureTime: new Date(DEPARTURE),
          arrivalTime: new Date(DEPARTURE + 11 * 3_600_000),
          status: "flown",
        },
      });
      const points = Array.from({ length: 20 }, (_, i) => ({
        t: DEPARTURE + i * 60_000,
        lat: 50,
        lon: 8 + i * 0.2,
        alt: 10_000,
        speed: 240,
      }));
      const res = await request(app)
        .post(`/api/v1/flights/${flight.id}/track`)
        .set("Cookie", cookie)
        .send({ uploadId: "queued-flight-before-switch", points });
      expect(res.status).toBe(201);
    });
  });
});
