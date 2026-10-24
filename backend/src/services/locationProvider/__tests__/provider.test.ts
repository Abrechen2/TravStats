import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { encryptApiKey } from "../../../utils/encryption";
import {
  getLocationProvider,
  providerIs,
  setLocationProvider,
  travTrackAvailable,
} from "../provider";

/**
 * The per-user location provider (TravTrack plan, task S2). What it must hold:
 * a switch is a setting and nothing else — no track moves, no Dawarich
 * connection changes — Dawarich needs the user's OWN connection (the admin's
 * shared one would attribute the operator's movements to the account), and a
 * provider that stopped working says so instead of quietly becoming `none`.
 */

const USERNAME = "location-provider-svc";

async function ownDawarich(userId: string): Promise<void> {
  await prisma.userSettings.upsert({
    where: { userId },
    create: {
      userId,
      data: {},
      dawarichBaseUrl: "http://dawarich.local:3000",
      dawarichApiKey: encryptApiKey("own-key"),
    },
    update: {
      dawarichBaseUrl: "http://dawarich.local:3000",
      dawarichApiKey: encryptApiKey("own-key"),
    },
  });
}

async function trackCounts(): Promise<number[]> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT (SELECT count(*) FROM flight_tracks) AS n
     UNION ALL SELECT count(*) FROM trip_recording_batches
     UNION ALL SELECT count(*) FROM trip_route_tracks
     UNION ALL SELECT count(*) FROM cruise_tracks`
  );
  return rows.map((r) => Number(r.n));
}

describe("location provider", () => {
  let userId: string;
  let adminBefore: { id: number; url: string | null; key: string | null } | null = null;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    const admin = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    if (admin) {
      adminBefore = {
        id: admin.id,
        url: admin.globalDawarichBaseUrl,
        key: admin.globalDawarichApiKey,
      };
    }
  });

  beforeEach(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    if (adminBefore) {
      await prisma.adminSettings.update({
        where: { id: adminBefore.id },
        data: { globalDawarichBaseUrl: adminBefore.url, globalDawarichApiKey: adminBefore.key },
      });
    }
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("a user without settings has provider none", async () => {
    expect(await getLocationProvider(userId)).toEqual({ kind: "none", rev: 0, status: "ok" });
    expect(await providerIs(userId, "none")).toBe(true);
  });

  it("dawarich without an own connection is refused with DAWARICH_NOT_CONFIGURED", async () => {
    await expect(setLocationProvider(userId, "dawarich")).rejects.toMatchObject({
      statusCode: 409,
      code: "DAWARICH_NOT_CONFIGURED",
    });
    expect((await getLocationProvider(userId)).kind).toBe("none");
  });

  it("dawarich with only the admin-global connection is refused", async () => {
    const admin = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    const adminId = admin ? admin.id : (await prisma.adminSettings.create({ data: {} })).id;
    await prisma.adminSettings.update({
      where: { id: adminId },
      data: {
        globalDawarichBaseUrl: "http://shared-dawarich.local:3000",
        globalDawarichApiKey: encryptApiKey("shared-key"),
      },
    });

    await expect(setLocationProvider(userId, "dawarich")).rejects.toMatchObject({
      code: "DAWARICH_NOT_CONFIGURED",
    });
  });

  it("travtrack is refused with TRAVTRACK_UNAVAILABLE in phase 1", async () => {
    expect(await travTrackAvailable(userId)).toBe(false);
    await expect(setLocationProvider(userId, "travtrack")).rejects.toMatchObject({
      statusCode: 409,
      code: "TRAVTRACK_UNAVAILABLE",
    });
  });

  it("a switch bumps rev and leaves flight_tracks, trip_recording_batches, trip_route_tracks and cruise_tracks row counts unchanged", async () => {
    await ownDawarich(userId);
    const before = await trackCounts();

    expect(await setLocationProvider(userId, "dawarich")).toEqual({ kind: "dawarich", rev: 1 });
    expect(await setLocationProvider(userId, "none")).toEqual({ kind: "none", rev: 2 });
    // Choosing what is already chosen changes nothing, so it raises nothing.
    expect(await setLocationProvider(userId, "none")).toEqual({ kind: "none", rev: 2 });

    expect(await trackCounts()).toEqual(before);
    const settings = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(settings.dawarichBaseUrl).toBe("http://dawarich.local:3000");
    expect(settings.dawarichApiKey).not.toBeNull();
  });

  it("a removed own key reports dawarich / notConfigured, not none", async () => {
    await ownDawarich(userId);
    await setLocationProvider(userId, "dawarich");
    expect(await getLocationProvider(userId)).toEqual({ kind: "dawarich", rev: 1, status: "ok" });
    expect(await providerIs(userId, "dawarich")).toBe(true);

    await prisma.userSettings.update({ where: { userId }, data: { dawarichApiKey: null } });

    expect(await getLocationProvider(userId)).toEqual({
      kind: "dawarich",
      rev: 1,
      status: "notConfigured",
    });
    expect(await providerIs(userId, "dawarich")).toBe(false);
    expect(await providerIs(userId, "none")).toBe(false);
  });
});
