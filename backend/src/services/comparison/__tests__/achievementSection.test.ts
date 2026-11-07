import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { ensureAchievements } from "../../../data/achievements";
import { loadVisibleDomains } from "../../domainVisibility";
import { buildLeaderboardSnapshot } from "../aggregates";
import { buildAchievementSection } from "../achievementSection";
import { AVAILABLE_DOMAINS } from "../../../shared/domains";
import type { LeaderboardScope } from "../../../schemas/comparison";

jest.mock("../../domainVisibility", () => ({
  ...jest.requireActual("../../domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

const scope = (over: Partial<LeaderboardScope> = {}): LeaderboardScope => ({
  groups: ["trips", "achievements"],
  domains: ["flight", "lodging"],
  year: null,
  ...over,
});
let userId: string;

async function setProgress(code: string, progress: number) {
  const achievement = await prisma.achievement.findUniqueOrThrow({ where: { code } });
  await prisma.userAchievement.create({
    data: {
      userId,
      achievementId: achievement.id,
      progress,
      unlockedAt: new Date("2025-03-04T10:00:00Z"),
    },
  });
}

beforeAll(async () => {
  await ensureAchievements();
  userId = (
    await prisma.user.create({
      data: { username: `lb-ach-${randomUUID()}`, passwordHash: "test-only" },
    })
  ).id;
  await setProgress("AIRPORTS_10", 10);
  await setProgress("AIRPORTS_25", 5);
  await setProgress("FIRST_CHECKIN", 1);
});
beforeEach(() => {
  jest.mocked(loadVisibleDomains).mockResolvedValue(["flight", "lodging"]);
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

const codes = (s: Awaited<ReturnType<typeof buildAchievementSection>>) =>
  (s?.items ?? []).map((i) => i.code);

it("no section without the achievements group", async () => {
  expect(await buildAchievementSection(userId, scope({ groups: ["trips"] }))).toBeUndefined();
});

it("no section for a year scope", async () => {
  expect(await buildAchievementSection(userId, scope({ year: 2025 }))).toBeUndefined();
});

it("holds a badge by the live measure and reports progress as a fraction", async () => {
  const section = await buildAchievementSection(userId, scope());
  expect(section?.items.find((i) => i.code === "AIRPORTS_10")).toEqual({
    code: "AIRPORTS_10",
    unlocked: true,
    progress: 1,
  });
  expect(section?.items.find((i) => i.code === "AIRPORTS_25")).toEqual({
    code: "AIRPORTS_25",
    unlocked: false,
    progress: 0.2,
  });
});

it("a badge of an unshared domain is omitted", async () => {
  const section = await buildAchievementSection(userId, scope({ domains: ["flight"] }));
  expect(codes(section)).toContain("AIRPORTS_10");
  expect(codes(section)).not.toContain("FIRST_CHECKIN");
});

it("a cross-domain badge needs every available domain in the consent, whatever is visible", async () => {
  // FLY_AND_STAY is built from stays too: a flight+lodging scope is not enough, and switching a
  // domain off must not shrink what the consent has to cover.
  jest.mocked(loadVisibleDomains).mockResolvedValue(["flight"]);
  expect(codes(await buildAchievementSection(userId, scope()))).not.toContain("FLY_AND_STAY");
  const all = scope({ domains: [...AVAILABLE_DOMAINS] });
  expect(codes(await buildAchievementSection(userId, all))).toContain("FLY_AND_STAY");
});

it("never carries a non-comparable badge", async () => {
  const section = await buildAchievementSection(userId, scope());
  expect(codes(section)).not.toContain("POLAR_EXPLORER");
  expect(codes(section)).not.toContain("FAVORITE_ROUTE");
});

it("no item carries a date", async () => {
  const section = await buildAchievementSection(userId, scope());
  expect(JSON.stringify(section)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  expect(JSON.stringify(section)).not.toContain("unlockedAt");
});

it("a v1 snapshot is byte-identical to before", async () => {
  const withGroup = await buildLeaderboardSnapshot(userId, scope(), null, 1);
  const without = await buildLeaderboardSnapshot(userId, scope({ groups: ["trips"] }), null, 1);
  const strip = (s: object) => ({ ...s, asOf: "x" });
  expect(withGroup.version).toBe(1);
  expect(strip(withGroup)).toEqual(strip(without));
  expect(Object.keys(withGroup)).not.toContain("achievements");
});

it("a v2 snapshot carries the section when consented and omits the key otherwise", async () => {
  const v2 = await buildLeaderboardSnapshot(userId, scope(), null, 2);
  expect(v2.version).toBe(2);
  expect(v2.version === 2 && v2.achievements?.items.length).toBeGreaterThan(0);
  const none = await buildLeaderboardSnapshot(userId, scope({ groups: ["trips"] }), null, 2);
  expect(Object.keys(none)).not.toContain("achievements");
});
