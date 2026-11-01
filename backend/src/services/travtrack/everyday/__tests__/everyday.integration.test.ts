import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../../db";
import {
  calculateTravTrackAchievementStats,
  checkTravTrackAchievement,
} from "../../../../utils/travTrackAchievements";
import { SKIP } from "../../../../utils/badgeSource";
import { loadAchievementVisibility } from "../../../achievementVisibility";
import { setLocationProvider } from "../../../locationProvider/provider";
import { loadWrapped } from "../../../stats/wrappedLoad";
import { makeFlight, makeUser, storePoint, wipeTravTrack } from "../../__tests__/fixtures";
import { travTrackSwitches } from "../../__tests__/switches";
import { loadEverydaySummary } from "../load";
import { travTrackYearStats, yearWindow } from "../view";

/**
 * forgejo#400 — the everyday figures from stored points: privacy zones stay
 * out of every figure, a spike is dropped, and everything abstains while
 * TravTrack is not the account's working location source.
 */

const switches = travTrackSwitches();
const LON_PER_M = 1 / (111_320 * Math.cos((50 * Math.PI) / 180));
const day = (d: string, minutes = 0) => Date.parse(`${d}T09:00:00Z`) + minutes * 60_000;

let userId = "";
let otherId = "";

async function walk(user: string, d: string, spikeAt: number | null) {
  for (let i = 0; i < 30; i++) {
    await storePoint(user, {
      t: day(d, i),
      lat: 50,
      lon: 8 + 1.5 * 60 * i * LON_PER_M,
      speedMps: i === spikeAt ? 80 : 1.5,
      altitudeM: 400 + (i % 3),
      motion: i === spikeAt ? null : "walking",
    });
  }
}

/** A fast, high burst around 51°N 9°E — the account's privacy zone. */
async function zoneBurst(user: string, d: string) {
  for (let i = 0; i < 20; i++) {
    await storePoint(user, {
      t: day(d, i),
      lat: 51 + i * 1e-6,
      lon: 9,
      speedMps: 30,
      altitudeM: 3000,
      motion: "automotive",
    });
  }
}

beforeAll(async () => {
  await switches.set({ beta: true, config: true });
  userId = await makeUser("everyday400");
  otherId = await makeUser("everyday400none");
  await wipeTravTrack([userId, otherId]);
  await walk(userId, "2026-06-01", 7);
  await walk(userId, "2026-06-03", null);
  await prisma.travTrackPrivacyZone.create({
    data: { userId, name: "Home", lat: 51, lon: 9, radiusM: 300 },
  });
  await zoneBurst(userId, "2026-06-05");
  await walk(otherId, "2026-06-01", null);
  await setLocationProvider(userId, "travtrack");
  await makeFlight(userId);
});

afterAll(async () => {
  await wipeTravTrack([userId, otherId]);
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  await switches.restore();
});

describe("everyday figures from stored points", () => {
  it("leaves a privacy zone out of every figure and a GPS spike out of the top speed", async () => {
    const summary = await loadEverydaySummary(userId, await yearWindow(userId, 2026));
    expect(summary).not.toBeNull();
    // Only the two walking days: the zone burst's day (and its 30 m/s, 3000 m) is not in any figure.
    expect(summary!.days).toBe(2);
    expect(summary!.figures.topSpeed?.mps).toBe(1.5);
    expect(summary!.figures.highest!.m).toBeLessThan(410);
    expect(summary!.figures.byMotion.automotive).toEqual({ ms: 0, km: 0 });
    expect(summary!.figures.byMotion.walking.ms).toBeGreaterThan(0);
  });

  it("abstains with null for a window without a single safe fix", async () => {
    expect(await loadEverydaySummary(userId, await yearWindow(userId, 2019))).toBeNull();
  });

  it("year stats are null for an account whose location source is not TravTrack", async () => {
    expect(await travTrackYearStats(otherId, 2026)).toBeNull();
    const own = await travTrackYearStats(userId, 2026);
    expect(own).toMatchObject({ daysRecorded: 2, topSpeedKmh: 5 });
  });

  it("the year in review carries TravTrack for its owner and never in a share-link build", async () => {
    const owner = await loadWrapped(userId, 2026, { withTravTrack: true });
    expect(owner?.travTrack?.daysRecorded).toBe(2);
    const shared = await loadWrapped(userId, 2026);
    expect(shared).not.toBeNull();
    expect("travTrack" in shared!).toBe(false);
  });

  it("year in review: travTrack is null once TravTrack is switched off", async () => {
    await switches.set({ beta: true, config: false });
    try {
      const wrapped = await loadWrapped(userId, 2026, { withTravTrack: true });
      expect(wrapped?.travTrack).toBeNull();
    } finally {
      await switches.set({ beta: true, config: true });
    }
  });
});

describe("TravTrack badges", () => {
  it("measure the monthly values, and SKIP rather than answer 0 while TravTrack is not in use", async () => {
    await prisma.travTrackMonthValue.createMany({
      data: ["2026-05-01", "2026-06-01"].map((m) => ({
        userId,
        month: new Date(m),
        kmGround: 600.5,
        countries: [],
        daysWithData: 20,
        daysPaused: 0,
        algorithm: 1,
      })),
    });
    const stats = await calculateTravTrackAchievementStats(userId);
    expect(stats).toMatchObject({ active: true, daysRecorded: 40 });
    const km1000 = { requirementType: "travtrack_ground_km", requirement: 1000 };
    expect(checkTravTrackAchievement(km1000, stats)).toEqual({ isUnlocked: true, progress: 1201 });
    expect(
      checkTravTrackAchievement({ requirementType: "travtrack_days", requirement: 365 }, stats)
    ).toEqual({ isUnlocked: false, progress: 40 });

    const idle = await calculateTravTrackAchievementStats(otherId);
    expect(checkTravTrackAchievement(km1000, idle)).toBe(SKIP);
    expect(
      checkTravTrackAchievement({ requirementType: "flights_count", requirement: 1 }, idle)
    ).toBe(null);
  });

  it("are listed only while TravTrack is the account's location source", async () => {
    expect((await loadAchievementVisibility(userId))("shared", "TRAVTRACK_KM_1000")).toBe(true);
    expect((await loadAchievementVisibility(otherId))("shared", "TRAVTRACK_KM_1000")).toBe(false);
  });
});
