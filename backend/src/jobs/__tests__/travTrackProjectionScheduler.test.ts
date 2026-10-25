import { prisma } from "../../db";
import { utcMidnight } from "../../services/countryDays/store";
import { setLocationProvider } from "../../services/locationProvider/provider";
import {
  ALL_PROJECTION_BITS,
  COUNTRY_DAYS_BIT,
  markTravTrackDaysDirty,
} from "../../services/travtrack/dirtyDays";
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

  it("projects the explored map's cells in the same run (L1)", async () => {
    await runTravTrackProjections({ countryAt });

    expect(await prisma.travTrackExploredCell.count({ where: { userId } })).toBe(2);
    const rows = await prisma.travTrackDirtyDay.findMany({ where: { userId } });
    expect(rows.map((r) => r.done & ALL_PROJECTION_BITS)).toEqual([
      ALL_PROJECTION_BITS,
      ALL_PROJECTION_BITS,
    ]);
  });

  it("an account whose only owed work is the explored map is still picked (L1)", async () => {
    // As the L1 migration leaves an account: country days acked, cells owed.
    await prisma.travTrackDirtyDay.updateMany({
      where: { userId },
      data: { done: COUNTRY_DAYS_BIT },
    });
    await prisma.travTrackDerivationState.create({
      data: { userId, countryReducerVersion: 99 },
    });

    await runTravTrackProjections({ countryAt });

    expect(await prisma.travTrackExploredCell.count({ where: { userId } })).toBe(2);
  });

  it("skips an account whose provider is not TravTrack", async () => {
    await setLocationProvider(userId, "none");

    await runTravTrackProjections({ countryAt });

    expect(await prisma.countryDay.count({ where: { userId } })).toBe(0);
    expect(await prisma.travTrackDirtyDay.count({ where: { userId, done: 0 } })).toBe(2);
  });

  it("with TravTrack off does nothing; the dirty days wait", async () => {
    await switches.set({ beta: true, config: false });

    const result = await runTravTrackProjections({ countryAt });

    expect(result).toEqual({ accounts: 0, failed: 0, questions: 0, days: 0 });
    expect(await prisma.countryDay.count({ where: { userId } })).toBe(0);
    expect(await prisma.travTrackDirtyDay.count({ where: { userId, done: 0 } })).toBe(2);
  });

  it("questions deferred past the cap keep the account scheduled until they are asked", async () => {
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    await wipeTravTrack([userId]);
    for (const code of ["PT", "ES", "FR", "IT", "AT"]) {
      for (const day of ["2026-10-12", "2026-10-13"]) {
        await prisma.countryDay.create({
          data: {
            userId,
            source: "travtrack",
            date: utcMidnight(day),
            countryCode: code,
            pointCount: 5,
            airportPointCount: 0,
            spanKm: 1,
          },
        });
      }
    }
    // As a projection that changed these rows leaves it.
    await prisma.travTrackDerivationState.create({
      data: { userId, countryReducerVersion: 99, countryQuestionsDue: true },
    });

    const first = await runTravTrackProjections({ countryAt });
    expect(first.questions).toBe(3);
    expect(
      (await prisma.travTrackDerivationState.findUniqueOrThrow({ where: { userId } }))
        .countryQuestionsDue
    ).toBe(true);

    // Nothing is dirty any more; the owed questions alone schedule it.
    const second = await runTravTrackProjections({ countryAt });
    expect(second.questions).toBe(2);
    const state = await prisma.travTrackDerivationState.findUniqueOrThrow({ where: { userId } });
    expect(state.countryQuestionsDue).toBe(false);
    expect((await runTravTrackProjections({ countryAt })).accounts).toBe(0);
  });

  it("a failed run is retried after a growing backoff, not on every tick", async () => {
    const now = new Date("2026-10-25T12:00:00Z");
    const broken = () => {
      throw new Error("boundary index unreadable");
    };

    const failed = await runTravTrackProjections({ countryAt: broken, now });
    expect(failed.failed).toBe(1);
    const state = await prisma.travTrackDerivationState.findUniqueOrThrow({ where: { userId } });
    expect(state.failureCount).toBe(1);
    expect(state.retryAfter!.getTime()).toBeGreaterThan(now.getTime());

    // Inside the backoff the account is left alone.
    expect((await runTravTrackProjections({ countryAt, now })).accounts).toBe(0);

    // A second failure waits longer.
    const later = new Date(state.retryAfter!.getTime() + 1000);
    await runTravTrackProjections({ countryAt: broken, now: later });
    const twice = await prisma.travTrackDerivationState.findUniqueOrThrow({ where: { userId } });
    expect(twice.failureCount).toBe(2);
    expect(twice.retryAfter!.getTime() - later.getTime()).toBeGreaterThan(
      state.retryAfter!.getTime() - now.getTime()
    );

    // After it, the work is done and the failures are forgotten.
    const after = new Date(twice.retryAfter!.getTime() + 1000);
    const ok = await runTravTrackProjections({ countryAt, now: after });
    expect(ok).toMatchObject({ accounts: 1, failed: 0, questions: 1 });
    const done = await prisma.travTrackDerivationState.findUniqueOrThrow({ where: { userId } });
    expect(done).toMatchObject({ failureCount: 0, retryAfter: null, countryQuestionsDue: false });
  });

  it("a question run that fails keeps the questions owed and is retried after the backoff", async () => {
    const now = new Date("2026-10-25T12:00:00Z");
    const failing = jest.fn(async () => {
      throw new Error("database gone");
    });

    const result = await runTravTrackProjections({ countryAt, now, suggest: failing });
    expect(result.failed).toBe(1);
    const state = await prisma.travTrackDerivationState.findUniqueOrThrow({ where: { userId } });
    expect(state).toMatchObject({ countryQuestionsDue: true, failureCount: 1 });

    const after = new Date(state.retryAfter!.getTime() + 1000);
    expect((await runTravTrackProjections({ countryAt, now: after })).questions).toBe(1);
  });

  it("a tick works through at most its budget of accounts, and the next continues with the rest", async () => {
    const otherId = await makeUser(`${PREFIX}b`);
    await setLocationProvider(otherId, "travtrack");
    await storePoint(otherId, { t: Date.parse("2026-10-12T10:00:00Z"), lat: 38.72, lon: -9.14 });
    await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, otherId, ["2026-10-12"]));
    const projectedOf = (id: string) => prisma.countryDay.count({ where: { userId: id } });

    expect((await runTravTrackProjections({ countryAt, maxAccounts: 1 })).accounts).toBe(1);
    const firstTick = [await projectedOf(userId), await projectedOf(otherId)];
    expect(firstTick.filter((n) => n > 0)).toHaveLength(1);

    expect((await runTravTrackProjections({ countryAt, maxAccounts: 1 })).accounts).toBe(1);
    expect(await projectedOf(userId)).toBeGreaterThan(0);
    expect(await projectedOf(otherId)).toBeGreaterThan(0);
  });

  it("a tick projects at most its budget of days; the rest wait for the next", async () => {
    const result = await runTravTrackProjections({ countryAt, maxDays: 1 });
    expect(result.days).toBe(1);
    expect(await prisma.travTrackDirtyDay.count({ where: { userId, done: 0 } })).toBe(1);

    await runTravTrackProjections({ countryAt, maxDays: 1 });
    expect(await prisma.travTrackDirtyDay.count({ where: { userId, done: 0 } })).toBe(0);
  });
});
