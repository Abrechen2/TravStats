import { prisma } from "../../../db";
import { setClockForTests } from "../../../shared/time/clock";
import { tripEntryTrack } from "../../locationProvider/entryTrack";
import { setLocationProvider } from "../../locationProvider/provider";
import { makeUser, storePoint, wipeTravTrack } from "../../travtrack/__tests__/fixtures";
import { travTrackSwitches } from "../../travtrack/__tests__/switches";
import { clearActualTrackCache, getActualRoute } from "../actual/actualRoute";
import {
  MUNICH,
  SALZBURG,
  driveNear,
  makePlanTrip,
  noon,
  ownRecording,
} from "./planActualFixtures";

jest.mock("../../locationProvider/entryTrack", () => {
  const real = jest.requireActual("../../locationProvider/entryTrack");
  return { ...real, tripEntryTrack: jest.fn(real.tripEntryTrack) };
});
const reads = tripEntryTrack as jest.MockedFunction<typeof tripEntryTrack>;

/**
 * The trip's track is read once per change, not once per request (TravTrack
 * plan L5, Codex review P2): concurrent requests share one read, a repeat
 * within the TTL is served from memory, and anything that changes what the
 * track may show — a new recording or point, a removal, a privacy zone, the
 * provider — reads again at once.
 */

const PREFIX = "plan-actual-cache-";
const T0 = Date.parse("2026-10-25T12:00:00Z");

describe("the actual-track cache", () => {
  const switches = travTrackSwitches();
  let userId: string;

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });
  beforeEach(async () => {
    clearActualTrackCache();
    reads.mockClear();
    setClockForTests(new Date(T0));
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    setClockForTests(null);
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("concurrent requests share one read; a repeat within the TTL reads nothing", async () => {
    const { tripId } = await makePlanTrip(userId);
    await ownRecording(userId, tripId, driveNear(MUNICH, noon(1)));
    const [a, b] = await Promise.all([
      getActualRoute(userId, tripId),
      getActualRoute(userId, tripId),
    ]);
    expect(a!.positions).toEqual(b!.positions);
    await getActualRoute(userId, tripId);
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("reads again once the TTL is over", async () => {
    const { tripId } = await makePlanTrip(userId);
    await ownRecording(userId, tripId, driveNear(MUNICH, noon(1)));
    await getActualRoute(userId, tripId);
    setClockForTests(new Date(T0 + 61_000));
    await getActualRoute(userId, tripId);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it("a new recording is seen at once", async () => {
    const { tripId } = await makePlanTrip(userId);
    await ownRecording(userId, tripId, driveNear(MUNICH, noon(1)));
    const before = await getActualRoute(userId, tripId);
    await ownRecording(userId, tripId, driveNear(SALZBURG, noon(3)));
    const after = await getActualRoute(userId, tripId);
    expect(after!.positions.length).toBeGreaterThan(before!.positions.length);
  });

  it("a new TravTrack point and a removal (history generation) are seen at once", async () => {
    const { tripId } = await makePlanTrip(userId);
    await setLocationProvider(userId, "travtrack");
    for (const [t, lat, lon] of driveNear(MUNICH, noon(1)))
      await storePoint(userId, { t, lat, lon });
    await getActualRoute(userId, tripId);
    for (const [t, lat, lon] of driveNear(SALZBURG, noon(3)))
      await storePoint(userId, { t, lat, lon });
    expect((await getActualRoute(userId, tripId))!.positions.some((p) => p.lat < 47.9)).toBe(true);

    await prisma.travTrackPoint.deleteMany({
      where: { userId, t: { gte: new Date(noon(3) - 60_000) } },
    });
    await prisma.travTrackDerivationState.upsert({
      where: { userId },
      create: { userId, historyGeneration: 1n },
      update: { historyGeneration: { increment: 1n } },
    });
    expect((await getActualRoute(userId, tripId))!.positions.some((p) => p.lat < 47.9)).toBe(false);
    expect(reads).toHaveBeenCalledTimes(3);
  });

  it("a new privacy zone is in force at once: nothing cached from before it is served", async () => {
    const { tripId } = await makePlanTrip(userId);
    await ownRecording(userId, tripId, driveNear(MUNICH, noon(1)));
    expect((await getActualRoute(userId, tripId))!.positions.length).toBeGreaterThan(0);
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Home", ...MUNICH, radiusM: 5000 },
    });
    expect((await getActualRoute(userId, tripId))!.positions).toEqual([]);
  });

  it("a failed read is not cached", async () => {
    const { tripId } = await makePlanTrip(userId);
    await ownRecording(userId, tripId, driveNear(MUNICH, noon(1)));
    reads.mockRejectedValueOnce(new Error("provider down"));
    await expect(getActualRoute(userId, tripId)).rejects.toThrow("provider down");
    expect((await getActualRoute(userId, tripId))!.positions.length).toBeGreaterThan(0);
  });
});
