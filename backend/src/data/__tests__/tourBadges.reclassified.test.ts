import { randomUUID } from "crypto";
import { prisma } from "../../db";
import { ensureAchievements } from "../achievements";
import { achievementVisibility } from "../../services/achievementVisibility";

/**
 * The day-tour badges moved from `shared` to the `tour` domain (tours-own-domain T3). An account
 * that already holds one must keep it, with the date it was earned on: the unlock row hangs off
 * the achievement's id, which the reclassification must not touch.
 */
const CODES = ["TOUR_FIRST_STEPS", "TOUR_THREE_KINDS", "TOUR_ASCENT_1000"];
let userId: string;

beforeAll(async () => {
  await ensureAchievements();
  userId = (
    await prisma.user.create({
      data: { username: `tour-badge-${randomUUID()}`, passwordHash: "test-only" },
    })
  ).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

it("keeps an existing tour-badge unlock and its date when the badge becomes a tour-domain badge", async () => {
  const earned = new Date("2026-10-12T08:30:00Z");
  const first = await prisma.achievement.findUniqueOrThrow({ where: { code: "TOUR_FIRST_STEPS" } });
  // The state of a database from before the reclassification.
  await prisma.achievement.updateMany({
    where: { code: { in: CODES } },
    data: { domain: "shared" },
  });
  await prisma.userAchievement.create({
    data: { userId, achievementId: first.id, unlockedAt: earned, progress: 1 },
  });

  await ensureAchievements();

  const rows = await prisma.achievement.findMany({ where: { code: { in: CODES } } });
  expect(rows.map((r) => r.domain)).toEqual(CODES.map(() => "tour"));
  const kept = await prisma.userAchievement.findFirstOrThrow({
    where: { userId, achievement: { code: "TOUR_FIRST_STEPS" } },
  });
  expect(kept.achievementId).toBe(first.id);
  expect(kept.unlockedAt?.toISOString()).toBe(earned.toISOString());
});

it("shows a tour badge while the tour domain is visible and hides it otherwise", () => {
  expect(achievementVisibility(["flight", "tour"])("tour", "TOUR_FIRST_STEPS")).toBe(true);
  // Roadtrips on and tours off (or the beta gate closed, which drops `tour`): hidden.
  expect(achievementVisibility(["flight", "roadtrip"])("tour", "TOUR_FIRST_STEPS")).toBe(false);
});
