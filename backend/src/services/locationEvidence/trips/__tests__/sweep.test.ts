import { prisma } from "../../../../db";
import { travTrackSwitches } from "../../../travtrack/__tests__/switches";
import { runTravTrackTripSweep } from "../sweep";
import { AWAY, NOW, makeTripUser, resetTripUser, storeDay } from "./tripFixtures";

/**
 * The nightly trip sweep (TravTrack plan L4): TravTrack accounts only — a
 * Dawarich account is never asked (open owner decision (c)) — and nothing at
 * all while TravTrack is off.
 */

const PREFIX = "travtrack-trip-sweep-";

beforeAll(() => {
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
});

describe("runTravTrackTripSweep", () => {
  const switches = travTrackSwitches();
  let travtrack: string;
  let dawarich: string;

  const questions = (userId: string) =>
    prisma.locationSuggestion.count({ where: { userId, kind: "trip" } });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    travtrack = await makeTripUser(`${PREFIX}t`);
    dawarich = await makeTripUser(`${PREFIX}d`, { locationProvider: "dawarich" });
  });

  beforeEach(async () => {
    for (const id of [travtrack, dawarich]) {
      await resetTripUser(id);
      await storeDay(id, "2026-10-10", AWAY);
      await storeDay(id, "2026-10-11", AWAY);
    }
    await prisma.userSettings.update({
      where: { userId: dawarich },
      data: { locationProvider: "dawarich" },
    });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("asks TravTrack accounts and never a Dawarich one", async () => {
    await switches.set({ beta: true, config: true });
    await runTravTrackTripSweep(NOW);
    expect(await questions(travtrack)).toBe(1);
    expect(await questions(dawarich)).toBe(0);
  });

  it("does nothing while TravTrack is off", async () => {
    await switches.set({ beta: true, config: false });
    await runTravTrackTripSweep(NOW);
    expect(await questions(travtrack)).toBe(0);
  });
});
