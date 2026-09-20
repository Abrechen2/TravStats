/**
 * What a re-check plans to write — and, since 2026-09-19, what it refuses to.
 *
 * The engine used to treat a falling measure as a revocation: it wrote the new
 * progress AND cleared `unlockedAt`. The integrity audit of that day restored
 * the 2.6.2 prod mirror and booted it; AWAY_SHARE_25, earned 2026-09-03, came
 * back at progress 24 with a null date, because the away-share denominator
 * grows with every day of the current year. Nobody un-travelled anything.
 *
 * The owner's ruling of 2026-09-20 narrowed what that fix protects. A badge
 * whose measure has fallen IS lost, with its points — held-ness is the live
 * number (`achievementHeld.ts`). The date is what is never destroyed: it is
 * the historical fact of when the requirement was first met, and the only
 * thing that lets the page say when the badge was last held. So these tests
 * pin the write, not the badge.
 *
 * `planAchievementWrites` is pure, so these run without a database.
 */

import { planAchievementWrites } from "../achievementWrites";
import type { Achievement, UserAchievement } from "../../prisma";
import type { FlightData, UserStats } from "../achievementStats";

const AIRPORTS_10: Achievement = {
  id: "ach-airports-10",
  code: "AIRPORTS_10",
  name: "Ten airports",
  description: "Visit ten airports",
  category: "explorer",
  domain: "flight",
  icon: "plane",
  tier: "bronze",
  requirement: 10,
  requirementType: "airports",
  points: 10,
  isHidden: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

/** A `UserStats` carrying only the measure these tests exercise. */
function statsWithAirports(count: number): UserStats {
  const airports = new Set<string>();
  for (let i = 0; i < count; i += 1) airports.add(`A${i}`);
  return { airports } as unknown as UserStats;
}

function row(overrides: Partial<UserAchievement>): UserAchievement {
  return {
    id: "row-1",
    userId: "user-1",
    achievementId: AIRPORTS_10.id,
    progress: 0,
    unlockedAt: null,
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  } as UserAchievement;
}

const NO_FLIGHTS: FlightData[] = [];

function planFor(existing: UserAchievement | null, airports: number) {
  const map = new Map<string, UserAchievement>();
  if (existing) map.set(AIRPORTS_10.id, existing);
  return planAchievementWrites([AIRPORTS_10], map, statsWithAirports(airports), NO_FLIGHTS);
}

describe("planAchievementWrites — the measure moves, the unlock date does not", () => {
  it("lowers the measure of a held badge without touching its unlock date", () => {
    const held = row({ progress: 10, unlockedAt: new Date("2026-09-03T12:00:00Z") });

    const plan = planFor(held, 4);

    expect(plan.writes).toEqual([{ kind: "progress", rowId: "row-1", progress: 4 }]);
    // The write carries no `unlockedAt` key at all — not null, absent. This is
    // the assertion that fails on the pre-2026-09-19 plan, which carried
    // `revoking: true` and had `applyAchievementWrites` write NULL.
    expect(Object.keys(plan.writes[0])).not.toContain("unlockedAt");
    expect(Object.keys(plan.writes[0])).not.toContain("revoking");
    // Reported: the user has just stopped holding this badge, which is worth a
    // log line even though the row itself only records a new number.
    expect(plan.belowRequirement).toEqual(["AIRPORTS_10"]);
  });

  it("writes nothing when a lapsed badge is re-measured at the same value", () => {
    // The state the previous case leaves behind: date set, measure below the
    // requirement. A second run has nothing to say — in particular it must not
    // reach for the date, which is the one thing here that cannot be rebuilt.
    const dipped = row({ progress: 4, unlockedAt: new Date("2026-09-03T12:00:00Z") });

    const plan = planFor(dipped, 4);

    expect(plan.writes).toEqual([]);
    expect(plan.belowRequirement).toEqual([]);
  });

  it("does not re-announce a badge whose measure recovers", () => {
    // The user holds it again, and the trophy case says so again — but no
    // popup: `unlockedAt` already records the first time, and an achievement
    // announces a first time, not a return.
    const dipped = row({ progress: 4, unlockedAt: new Date("2026-09-03T12:00:00Z") });

    const plan = planFor(dipped, 12);

    expect(plan.writes).toEqual([
      {
        kind: "unlock",
        achievementId: AIRPORTS_10.id,
        requirement: 10,
        wasUnlocked: false,
        // The date is already there, so no new one is stamped and no unlock
        // event is emitted.
        hadUnlockDate: true,
      },
    ]);
  });

  it("stamps a date on an old row that meets its requirement without one", () => {
    // Left behind by the revoke path this change removed, or by a run before
    // the column meant anything. The badge is held by its numbers; the record
    // of when is missing, and this is where it gets filled in.
    const undated = row({ progress: 10, unlockedAt: null });

    const plan = planFor(undated, 12);

    expect(plan.writes).toEqual([
      {
        kind: "unlock",
        achievementId: AIRPORTS_10.id,
        requirement: 10,
        wasUnlocked: true,
        hadUnlockDate: false,
      },
    ]);
  });

  it("still announces a first unlock, and still tracks a row that was never earned", () => {
    const firstUnlock = planFor(null, 12);
    expect(firstUnlock.writes).toEqual([
      {
        kind: "unlock",
        achievementId: AIRPORTS_10.id,
        requirement: 10,
        wasUnlocked: false,
        hadUnlockDate: false,
      },
    ]);
    expect(firstUnlock.belowRequirement).toEqual([]);

    const tracked = planFor(null, 4);
    expect(tracked.writes).toEqual([{ kind: "track", achievementId: AIRPORTS_10.id, progress: 4 }]);
    // Never held, so nothing to report as having fallen.
    expect(tracked.belowRequirement).toEqual([]);
  });

  it("writes nothing at all in the steady state", () => {
    const steady = row({ progress: 10, unlockedAt: new Date("2026-09-03T12:00:00Z") });
    expect(planFor(steady, 12).writes).toEqual([]);
  });
});
