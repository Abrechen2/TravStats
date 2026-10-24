/**
 * Dawarich's automatic features follow the chosen location provider (TravTrack
 * plan, task S3; review focus 1). Against the database, because the filter is
 * a query and a mocked Prisma would only echo it back:
 *
 * - the nightly country-day sweep and the six-hourly stay scan (which carries
 *   market visits) run for provider `dawarich` exactly as before, and skip an
 *   account whose provider is `none` even when it has its own connection;
 * - "scan now", pressed by the person, still runs whatever the provider — a
 *   one-off copy into the account, like a GPX upload.
 *
 * Nothing leaves the process: the per-account walk, the stay scan's work and
 * the Dawarich client are replaced.
 */
import request from "supertest";
import { prisma } from "../../db";
import { encryptApiKey } from "../../utils/encryption";
import { generateToken } from "../../utils/jwt";
import type { DawarichClient, DawarichPoint } from "../../services/dawarich/dawarichClient";

jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));

const sweptUsers: string[] = [];
jest.mock("../../services/dawarich/countryDaySweep", () => ({
  sweepUserCountryDays: async (userId: string) => {
    sweptUsers.push(userId);
    return {
      userId,
      monthsSwept: 0,
      windowsRequested: 0,
      daysWritten: 0,
      partialDays: 0,
      backfillComplete: true,
      errorKind: null,
    };
  },
}));
jest.mock("../../services/countryDays/knownAirports", () => ({
  buildKnownAirportTest: async () => () => false,
}));
jest.mock("../../services/countryDays/flightAirTime", () => ({
  buildFlightAirTimeTest: async () => () => false,
}));

const points: DawarichPoint[] = [0, 10, 20, 30].map((m, i) => ({
  id: i + 1,
  latitude: 37.57,
  longitude: 126.97,
  timestampMs: Date.now() - 2 * 86_400_000 + m * 60_000,
  accuracy: 10,
  altitude: null,
  velocity: null,
  trackId: null,
}));
const fakeClient: DawarichClient = {
  checkHealth: async () => ({ reachable: true, version: null }),
  getPoints: async () => ({ points, truncated: false }),
};
jest.mock("../../services/dawarich/dawarichClient", () => ({
  ...jest.requireActual("../../services/dawarich/dawarichClient"),
  createDawarichClient: () => fakeClient,
}));

import app from "../../index";
import { runDawarichCountryDaySweep } from "../dawarichCountryDaySweepScheduler";
import { runDawarichStaySweep } from "../dawarichStayScheduler";

const STAMP = Date.now();
let dawarichUser: string;
let noneUser: string;

async function connectedUser(name: string, provider: "none" | "dawarich"): Promise<string> {
  const id = (
    await prisma.user.create({
      data: { username: `${name}-${STAMP}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
  await prisma.userSettings.create({
    data: {
      userId: id,
      data: {},
      enabledDomains: ["poi"],
      dawarichBaseUrl: "http://dawarich.local:3000",
      dawarichApiKey: encryptApiKey("own-key"),
      locationProvider: provider,
    },
  });
  await prisma.dawarichStayScan.create({ data: { userId: id, enabled: true } });
  return id;
}

async function scanState(userId: string) {
  return prisma.dawarichStayScan.findUniqueOrThrow({ where: { userId } });
}

beforeAll(async () => {
  dawarichUser = await connectedUser("gate-dawarich", "dawarich");
  noneUser = await connectedUser("gate-none", "none");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [dawarichUser, noneUser] } } });
  await prisma.$disconnect();
});

describe("the nightly country-day sweep", () => {
  it("runs for provider dawarich exactly as before", async () => {
    sweptUsers.length = 0;
    await runDawarichCountryDaySweep({ countryAt: () => null, createClient: () => fakeClient });
    expect(sweptUsers).toContain(dawarichUser);
  });

  it("skips a user whose provider is none even with an own connection", async () => {
    sweptUsers.length = 0;
    await runDawarichCountryDaySweep({ countryAt: () => null, createClient: () => fakeClient });
    expect(sweptUsers).not.toContain(noneUser);
  });
});

describe("the scheduled stay scan (market visits ride inside it)", () => {
  beforeAll(async () => {
    await runDawarichStaySweep();
  });

  it("runs for provider dawarich exactly as before", async () => {
    expect((await scanState(dawarichUser)).result).toBe("succeeded");
    expect(await prisma.dawarichStay.count({ where: { userId: dawarichUser } })).toBe(1);
  });

  it("skips a user whose provider is none even with an own connection", async () => {
    expect((await scanState(noneUser)).result).toBeNull();
    expect(await prisma.dawarichStay.count({ where: { userId: noneUser } })).toBe(0);
  });
});

describe("scan now, pressed by the person", () => {
  it("still runs for a provider-none user with an own connection", async () => {
    const res = await request(app)
      .post("/api/v1/dawarich-stays/scan")
      .set("Cookie", `auth_token=${generateToken(noneUser)}`)
      .send({})
      .expect(202);
    expect(res.body.data.jobId).toEqual(expect.any(String));

    const deadline = Date.now() + 10_000;
    while ((await scanState(noneUser)).result === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect((await scanState(noneUser)).result).toBe("succeeded");
    expect(await prisma.dawarichStay.count({ where: { userId: noneUser } })).toBe(1);
  });
});
