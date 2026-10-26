/**
 * Stay-scan consent by location source (TravTrack plan E3, owner decision
 * 2026-10-25): a TravTrack account consents through its provider — no own
 * Dawarich connection needed — while the instance's TravTrack is on. Switched
 * off, a consent change is refused with TRAVTRACK_DISABLED; revoking always
 * works. Provider dawarich and none keep today's rule: an own connection.
 */
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { encryptApiKey } from "../../utils/encryption";
import { generateToken } from "../../utils/jwt";
import { makeUser } from "../../services/travtrack/__tests__/fixtures";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { reserveScan, scanStays } from "../../services/dawarich/stays/scan";
import type { DawarichClient } from "../../services/dawarich/dawarichClient";

jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));

const PREFIX = "stay-consent-source-";
const switches = travTrackSwitches();

async function account(
  name: string,
  provider: "none" | "dawarich" | "travtrack",
  ownDawarich: boolean
): Promise<{ id: string; cookie: string }> {
  const id = await makeUser(`${PREFIX}${name}`);
  await prisma.userSettings.create({
    data: {
      userId: id,
      data: {},
      enabledDomains: ["poi"],
      locationProvider: provider,
      ...(ownDawarich
        ? {
            dawarichBaseUrl: "http://dawarich.local:3000",
            dawarichApiKey: encryptApiKey("own-key"),
          }
        : {}),
    },
  });
  return { id, cookie: `auth_token=${generateToken(id)}` };
}

const patch = (cookie: string, body: object) =>
  request(app).patch("/api/v1/dawarich-stays/settings").set("Cookie", cookie).send(body);
const settings = (cookie: string) =>
  request(app).get("/api/v1/dawarich-stays/settings").set("Cookie", cookie);

let travtrack: { id: string; cookie: string };
let dawarichNoConnection: { id: string; cookie: string };
let noneNoConnection: { id: string; cookie: string };
let noneConnected: { id: string; cookie: string };

beforeAll(async () => {
  travtrack = await account("travtrack", "travtrack", false);
  dawarichNoConnection = await account("dawarich", "dawarich", false);
  noneNoConnection = await account("none", "none", false);
  noneConnected = await account("none-own", "none", true);
});

beforeEach(async () => {
  await switches.set({ beta: true, config: true });
  await prisma.dawarichStayScan.deleteMany({
    where: { user: { username: { startsWith: PREFIX } } },
  });
});

afterAll(async () => {
  await switches.restore();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe("provider travtrack", () => {
  it("consents without an own Dawarich connection while TravTrack is on", async () => {
    expect((await patch(travtrack.cookie, { enabled: true })).status).toBe(200);
    expect((await patch(travtrack.cookie, { marketEnabled: true })).status).toBe(200);
    expect((await patch(travtrack.cookie, { venueEnabled: true })).status).toBe(200);
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({
      where: { userId: travtrack.id },
    });
    expect(state).toMatchObject({ enabled: true, marketEnabled: true, venueEnabled: true });
  });

  it("reports TravTrack as the source and as connected", async () => {
    await patch(travtrack.cookie, { enabled: true });
    const res = await settings(travtrack.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      source: "travtrack",
      connected: true,
      pausedReason: null,
    });
  });

  it("with TravTrack off, a consent change is refused with TRAVTRACK_DISABLED", async () => {
    await switches.set({ beta: true, config: false });
    const res = await patch(travtrack.cookie, { enabled: true });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
    expect(await prisma.dawarichStayScan.count({ where: { userId: travtrack.id } })).toBe(0);
  });

  it("with TravTrack off, revoking consent still works", async () => {
    await patch(travtrack.cookie, { enabled: true });
    await patch(travtrack.cookie, { marketEnabled: true });
    await switches.set({ beta: true, config: false });
    expect((await patch(travtrack.cookie, { marketEnabled: false })).status).toBe(200);
    expect((await patch(travtrack.cookie, { enabled: false })).status).toBe(200);
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({
      where: { userId: travtrack.id },
    });
    expect(state).toMatchObject({ enabled: false, marketEnabled: false });
  });

  it("with TravTrack off, the settings say so and name no Dawarich connection as missing", async () => {
    await patch(travtrack.cookie, { enabled: true });
    await switches.set({ beta: true, config: false });
    const res = await settings(travtrack.cookie);
    expect(res.body.data).toMatchObject({
      source: "travtrack",
      connected: false,
      pausedReason: "travTrackDisabled",
      nextScanAt: null,
    });
  });
});

describe("providers dawarich and none keep today's rule", () => {
  it("provider dawarich without an own connection is refused, TravTrack on or not", async () => {
    const res = await patch(dawarichNoConnection.cookie, { enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DAWARICH_OWN_CONNECTION_REQUIRED");
  });

  it("provider none without an own connection is refused", async () => {
    const res = await patch(noneNoConnection.cookie, { enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DAWARICH_OWN_CONNECTION_REQUIRED");
  });

  it("provider none with an own connection consents and reads Dawarich, as today", async () => {
    expect((await patch(noneConnected.cookie, { enabled: true })).status).toBe(200);
    const res = await settings(noneConnected.cookie);
    expect(res.body.data).toMatchObject({ connected: true });
    expect(res.body.data).not.toHaveProperty("source");
  });
});

/**
 * Golden: what a Dawarich account's settings answer held on main before
 * TravTrack — the fifteen `dawarich_stay_scans` columns, `times` and the
 * derived fields, and nothing else (no `source`, no scan `provider`). Instants
 * are normalised; everything else is compared as is.
 */
describe("a Dawarich account's settings answer is what it was", () => {
  const now = new Date("2026-10-11T06:00:00Z");
  const client: DawarichClient = {
    checkHealth: async () => ({ reachable: true, version: null }),
    getPoints: async () => ({
      points: [0, 10, 20, 30].map((m, i) => ({
        id: i + 1,
        latitude: 37.57,
        longitude: 126.97,
        timestampMs: Date.parse("2026-10-10T14:50:00Z") + m * 60_000,
        accuracy: 10,
        altitude: null,
        velocity: null,
        trackId: null,
      })),
      truncated: false,
    }),
  };
  const ISO = /^\d{4}-\d{2}-\d{2}T/;
  const normalise = (value: unknown): unknown => {
    if (typeof value === "string" && ISO.test(value)) return "<instant>";
    if (Array.isArray(value)) return value.map(normalise);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalise(v)]));
    return value;
  };
  const minute = {
    utc: "<instant>",
    local: "<instant>",
    offset: "+00:00",
    zone: "UTC",
    zoneSource: "stored",
    precision: "minute",
  };
  const expected = (userId: string) => ({
    userId,
    enabled: true,
    // Switching the scan on switches place detection on with it (forgejo#318),
    // so the scan also reports its venue pass.
    marketEnabled: true,
    venueEnabled: true,
    marketResult: {
      alreadyRecordedCount: 0,
      createdCount: 0,
      failedTiles: 0,
      invalidAreaCount: 0,
      limited: false,
      missingAreaCount: 0,
      scope: "venues",
      staleMapData: false,
      status: "complete",
      tiles: 0,
      totalTiles: 0,
    },
    startedAt: "<instant>",
    finishedAt: "<instant>",
    leaseUntil: null,
    result: "succeeded",
    error: null,
    dataThrough: "<instant>",
    windowStart: "<instant>",
    windowEnd: "<instant>",
    pointCount: 4,
    createdCount: 1,
    times: {
      startedAt: minute,
      finishedAt: minute,
      leaseUntil: null,
      dataThrough: minute,
      windowStart: minute,
      windowEnd: minute,
    },
    placesEnabled: true,
    pausedReason: null,
    nextScanAt: "<instant>",
    connected: true,
  });

  for (const provider of ["dawarich", "none"] as const) {
    it(`provider ${provider}: GET and PATCH answer exactly the fields of main`, async () => {
      const own = await account(`golden-${provider}`, provider, true);
      expect((await patch(own.cookie, { enabled: true })).status).toBe(200);
      await reserveScan(own.id, now);
      await scanStays(own.id, { now, client });
      // The scan records its source in its own column; the answer never shows it.
      expect(
        (await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId: own.id } })).provider
      ).toBe("dawarich");
      const got = await settings(own.cookie);
      expect(got.status).toBe(200);
      expect(normalise(got.body)).toEqual({ success: true, data: expected(own.id) });
      expect(Object.keys(got.body.data).sort()).toEqual(Object.keys(expected(own.id)).sort());

      const patched = await patch(own.cookie, { marketEnabled: false });
      const {
        placesEnabled: _p,
        pausedReason: _r,
        nextScanAt: _n,
        connected: _c,
        ...stored
      } = expected(own.id);
      expect(Object.keys(patched.body.data).sort()).toEqual(Object.keys(stored).sort());
    });
  }
});
