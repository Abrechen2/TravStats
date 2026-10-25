import { prisma } from "../../../db";
import { DEMO_USERNAME } from "../../../utils/sharedDemo";
import { setLocationProvider } from "../../locationProvider/provider";
import {
  holdsTravTrackData,
  travTrackAvailable,
  travTrackInstanceOn,
  travTrackOffered,
} from "../availability";
import { travTrackConfig } from "../config";
import { travTrackSwitches } from "./switches";

/**
 * TravTrack's instance gate (TravTrack plan, T1): the beta switch offers it,
 * the admin's own switch turns it on, the shared demo never gets it, and the
 * account's provider has nothing to do with whether the instance offers it.
 */

const PREFIX = "travtrack-avail-";

describe("TravTrack availability", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let demoId: string;
  let demoCreated = false;
  let demoWasDemo = true;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    userId = (await prisma.user.create({ data: { username: `${PREFIX}a`, passwordHash: "x" } })).id;
    const demo = await prisma.user.findUnique({ where: { username: DEMO_USERNAME } });
    if (demo) {
      demoId = demo.id;
      demoWasDemo = demo.isDemo;
    } else {
      demoId = (
        await prisma.user.create({
          data: { username: DEMO_USERNAME, passwordHash: "x", isDemo: true },
        })
      ).id;
      demoCreated = true;
    }
  });

  afterEach(async () => {
    delete process.env.TRAVTRACK_ENABLED;
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    if (demoCreated) await prisma.user.deleteMany({ where: { id: demoId } });
    else await prisma.user.update({ where: { id: demoId }, data: { isDemo: demoWasDemo } });
    await prisma.$disconnect();
  });

  it("off while the beta switch is off, even with the config row on", async () => {
    await switches.set({ beta: false, config: true });
    expect(await travTrackOffered()).toBe(false);
    expect(await travTrackInstanceOn()).toBe(false);
    expect(await travTrackAvailable(userId)).toBe(false);

    await switches.set({ beta: true, config: true });
    expect(await travTrackInstanceOn()).toBe(true);
    expect(await travTrackAvailable(userId)).toBe(true);
  });

  it("the env fallback applies only without a row", async () => {
    await switches.set({ beta: true, config: null });
    expect(await travTrackConfig()).toEqual({ enabled: false });
    process.env.TRAVTRACK_ENABLED = "true";
    expect(await travTrackConfig()).toEqual({ enabled: true });
    expect(await travTrackInstanceOn()).toBe(true);

    await switches.set({ beta: true, config: false });
    expect(await travTrackConfig()).toEqual({ enabled: false });
    expect(await travTrackInstanceOn()).toBe(false);
  });

  it("the shared demo account never gets it", async () => {
    await switches.set({ beta: true, config: true });
    await prisma.user.update({ where: { id: demoId }, data: { isDemo: true } });
    expect(await travTrackAvailable(demoId)).toBe(false);
    expect(await travTrackAvailable(userId)).toBe(true);
  });

  it("travTrackAvailable follows instance + demo, not the provider", async () => {
    await switches.set({ beta: true, config: true });
    await prisma.userSettings.deleteMany({ where: { userId } });
    expect(await travTrackAvailable(userId)).toBe(true);
    await setLocationProvider(userId, "travtrack");
    expect(await travTrackAvailable(userId)).toBe(true);
    await setLocationProvider(userId, "none");
    expect(await travTrackAvailable(userId)).toBe(true);
    await switches.set({ beta: true, config: false });
    expect(await travTrackAvailable(userId)).toBe(false);
  });

  it("holds data once any TravTrack table has a row for the account", async () => {
    await prisma.travTrackPrivacyZone.deleteMany({ where: { userId } });
    expect(await holdsTravTrackData(userId)).toBe(false);
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", lat: 1, lon: 1, radiusM: 100 },
    });
    expect(await holdsTravTrackData(userId)).toBe(true);
    await prisma.travTrackPrivacyZone.deleteMany({ where: { userId } });
    await prisma.travTrackDeletedRange.create({
      data: { userId, fromAt: new Date("2026-01-01Z"), toAt: new Date("2026-01-02Z") },
    });
    expect(await holdsTravTrackData(userId)).toBe(true);
    await prisma.travTrackDeletedRange.deleteMany({ where: { userId } });
  });

  it("an import, even a failed one without points, is TravTrack data", async () => {
    expect(await holdsTravTrackData(userId)).toBe(false);
    await prisma.travTrackImport.create({
      data: { userId, kind: "gpx", fileName: "x.gpx", status: "failed" },
    });
    expect(await holdsTravTrackData(userId)).toBe(true);
    await prisma.travTrackImport.deleteMany({ where: { userId } });
  });
});
