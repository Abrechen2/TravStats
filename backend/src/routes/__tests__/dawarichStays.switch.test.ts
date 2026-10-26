import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { encryptApiKey } from "../../utils/encryption";
import { generateToken } from "../../utils/jwt";
import { reserveScan, scanStays } from "../../services/dawarich/stays/scan";
import { runDawarichStaySweep } from "../../jobs/dawarichStayScheduler";
import type { DawarichClient, DawarichPoint } from "../../services/dawarich/dawarichClient";

jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));
// Accepting completes an address from its pin; no test reaches Nominatim.
jest.mock("../../services/geo/nominatim", () => ({
  ...jest.requireActual("../../services/geo/nominatim"),
  completeAddressFromCoordinates: jest.fn(async () => null),
}));

/**
 * The account's `staySuggestions.enabled` switch (forgejo#306). Off stops the
 * work, not just the tab: no reservation, no Dawarich request, no pending
 * suggestion offered — and nothing already decided is lost on the way back on.
 */

const DAWARICH_URL = "http://dawarich.switch.test";
const now = new Date("2026-10-11T06:00:00Z");
const points: DawarichPoint[] = [0, 10, 20, 30].map((m, i) => ({
  id: i + 1,
  latitude: 37.57,
  longitude: 126.97,
  timestampMs: Date.parse("2026-10-10T14:50:00Z") + m * 60_000,
  accuracy: 10,
  altitude: null,
  velocity: null,
  trackId: null,
}));

let userId: string;
let cookie: string;
let fetchSpy: jest.SpyInstance;

const setSwitch = (enabled: boolean) =>
  prisma.userSettings.update({ where: { userId }, data: { staySuggestionsEnabled: enabled } });

const dawarichCalls = () =>
  fetchSpy.mock.calls.filter(([url]) => String(url).startsWith(DAWARICH_URL)).length;

function countingClient(): DawarichClient & { calls: number } {
  const c = {
    calls: 0,
    checkHealth: async () => ({ reachable: true as const, version: null }),
    getPoints: async () => {
      c.calls++;
      return { points, truncated: false };
    },
  };
  return c;
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `stay-switch-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  cookie = `auth_token=${generateToken(userId)}`;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  fetchSpy = jest.spyOn(global, "fetch");
  await prisma.userSettings.upsert({
    where: { userId },
    create: {
      userId,
      enabledDomains: ["poi"],
      data: {},
      dawarichBaseUrl: DAWARICH_URL,
      dawarichApiKey: encryptApiKey("synthetic-dawarich-test-key"),
      // Dawarich is the chosen source, so only the switch can be what skips
      // the scheduled sweep below (TravTrack plan S3).
      locationProvider: "dawarich",
    },
    update: { enabledDomains: ["poi"], staySuggestionsEnabled: true },
  });
  await prisma.dawarichStay.deleteMany({ where: { userId } });
  await prisma.dawarichStayScan.upsert({
    where: { userId },
    create: { userId, enabled: true },
    update: { enabled: true, leaseUntil: null, startedAt: null, result: null },
  });
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("stay suggestions switched off (forgejo#306)", () => {
  it("POST /scan is refused before any reservation or Dawarich request", async () => {
    await setSwitch(false);
    const res = await request(app)
      .post("/api/v1/dawarich-stays/scan")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("STAY_SUGGESTIONS_DISABLED");
    expect(dawarichCalls()).toBe(0);
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
    expect(state.startedAt).toBeNull();
    expect(state.leaseUntil).toBeNull();
  });

  it("the scheduled sweep skips the account: no reservation, no Dawarich request", async () => {
    await setSwitch(false);
    await runDawarichStaySweep();
    expect(dawarichCalls()).toBe(0);
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
    expect(state.startedAt).toBeNull();
  });

  it("a scan reserved before the switch-off fetches no points", async () => {
    await reserveScan(userId, now);
    await setSwitch(false);
    const client = countingClient();
    await expect(scanStays(userId, { now, client })).rejects.toMatchObject({ statusCode: 502 });
    expect(client.calls).toBe(0);
    const state = await prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
    expect(state.error).toBe("STAY_SUGGESTIONS_DISABLED");
    expect(state.leaseUntil).toBeNull();
  });

  it("offers no pending suggestion, and the settings say why the scan is paused", async () => {
    await reserveScan(userId, now);
    await scanStays(userId, { now, client: countingClient() });
    expect(await prisma.dawarichStay.count({ where: { userId, status: "pending" } })).toBe(1);
    await setSwitch(false);

    const list = await request(app)
      .get("/api/v1/dawarich-stays?status=pending")
      .set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([]);

    const settings = await request(app)
      .get("/api/v1/dawarich-stays/settings")
      .set("Cookie", cookie);
    expect(settings.body.data.pausedReason).toBe("suggestionsDisabled");
    expect(settings.body.data.nextScanAt).toBeNull();
  });

  it("refuses to accept or reject while off", async () => {
    await reserveScan(userId, now);
    await scanStays(userId, { now, client: countingClient() });
    const row = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    await setSwitch(false);
    const reject = await request(app)
      .post(`/api/v1/dawarich-stays/${row.id}/reject`)
      .set("Cookie", cookie)
      .send({});
    expect(reject.status).toBe(409);
    expect(reject.body.code).toBe("STAY_SUGGESTIONS_DISABLED");
    expect((await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "pending"
    );
  });

  it("switching back on resumes from stored decisions: a rejected stay stays rejected", async () => {
    await reserveScan(userId, now);
    await scanStays(userId, { now, client: countingClient() });
    const row = await prisma.dawarichStay.findFirstOrThrow({ where: { userId } });
    await request(app)
      .post(`/api/v1/dawarich-stays/${row.id}/reject`)
      .set("Cookie", cookie)
      .send({})
      .expect(200);

    await setSwitch(false);
    await setSwitch(true);
    await reserveScan(userId, now);
    await scanStays(userId, { now, client: countingClient() });

    expect(await prisma.dawarichStay.count({ where: { userId } })).toBe(1);
    expect((await prisma.dawarichStay.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
      "rejected"
    );
  });
});
