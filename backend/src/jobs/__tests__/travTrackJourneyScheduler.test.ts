import { prisma } from "../../db";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import {
  NOW,
  makeJourneyUser,
  morning,
  resetJourneyUser,
  storeJourney,
} from "../../services/locationEvidence/journeys/__tests__/journeyFixtures";
import { runTravTrackJourneySweep } from "../travTrackJourneyScheduler";

/**
 * The nightly journey sweep (TravTrack plan E7): TravTrack accounts only, and
 * nothing at all while the instance's TravTrack is off.
 */

const PREFIX = "travtrack-journey-sweep-";

beforeAll(() => {
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
});

describe("runTravTrackJourneySweep", () => {
  const switches = travTrackSwitches();
  let travtrack: string;
  let dawarich: string;

  const questions = (userId: string) => prisma.locationSuggestion.count({ where: { userId } });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    travtrack = await makeJourneyUser(`${PREFIX}t`);
    dawarich = await makeJourneyUser(`${PREFIX}d`, { locationProvider: "dawarich" });
  });

  beforeEach(async () => {
    for (const id of [travtrack, dawarich]) {
      await resetJourneyUser(id);
      await storeJourney(id, morning("2026-10-20"));
    }
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("asks TravTrack accounts and never a Dawarich one", async () => {
    await switches.set({ beta: true, config: true });
    await runTravTrackJourneySweep(NOW);
    expect(await questions(travtrack)).toBe(1);
    expect(await questions(dawarich)).toBe(0);
  });

  it("does nothing while TravTrack is off", async () => {
    await switches.set({ beta: true, config: false });
    await runTravTrackJourneySweep(NOW);
    expect(await questions(travtrack)).toBe(0);
  });
});
