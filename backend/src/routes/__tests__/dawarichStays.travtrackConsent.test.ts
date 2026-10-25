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
    expect(res.body.data).toMatchObject({ source: "dawarich", connected: true });
  });
});
