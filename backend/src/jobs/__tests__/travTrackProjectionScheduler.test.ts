import { prisma } from "../../db";
import { utcMidnight } from "../../services/countryDays/store";
import { setLocationProvider } from "../../services/locationProvider/provider";
import { markTravTrackDaysDirty } from "../../services/travtrack/dirtyDays";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { runTravTrackProjections } from "../travTrackProjectionScheduler";

/**
 * The `travtrack_projections` cron row (TravTrack plan E6): every account with
 * dirty days is projected, then asked its country questions. With TravTrack
 * off nothing runs and the dirty days wait.
 */

const PREFIX = "travtrack-projection-job-";
/** Everything this test stores lies in Portugal. */
const countryAt = () => "PT";

describe("runTravTrackProjections", () => {
  const switches = travTrackSwitches();
  let userId: string;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= "c".repeat(64);
    userId = await makeUser(`${PREFIX}a`);
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId]);
    await prisma.countryDay.deleteMany({ where: { userId } });
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    await prisma.locationSuggestion.deleteMany({ where: { userId } });
    await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
    await setLocationProvider(userId, "travtrack");
    for (const day of ["2026-10-12", "2026-10-13"]) {
      await storePoint(userId, { t: Date.parse(`${day}T10:00:00Z`), lat: 38.72, lon: -9.14 });
      await storePoint(userId, { t: Date.parse(`${day}T12:00:00Z`), lat: 38.72, lon: -9.13 });
    }
    await prisma.$transaction((tx) =>
      markTravTrackDaysDirty(tx, userId, ["2026-10-12", "2026-10-13"])
    );
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("projects every account with dirty days, then asks its country questions", async () => {
    const result = await runTravTrackProjections({ countryAt });

    expect(result.accounts).toBeGreaterThanOrEqual(1);
    const days = await prisma.countryDay.findMany({ where: { userId, source: "travtrack" } });
    expect(days.map((d) => d.date)).toEqual(
      expect.arrayContaining([utcMidnight("2026-10-12"), utcMidnight("2026-10-13")])
    );
    expect(await prisma.locationSuggestion.count({ where: { userId, kind: "country" } })).toBe(1);
  });

  it("with TravTrack off does nothing; the dirty days wait", async () => {
    await switches.set({ beta: true, config: false });

    const result = await runTravTrackProjections({ countryAt });

    expect(result).toEqual({ accounts: 0, failed: 0, questions: 0 });
    expect(await prisma.countryDay.count({ where: { userId } })).toBe(0);
    expect(await prisma.travTrackDirtyDay.count({ where: { userId, done: 0 } })).toBe(2);
  });
});
