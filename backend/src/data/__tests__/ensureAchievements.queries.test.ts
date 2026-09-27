import { achievements, ensureAchievements } from "../achievements";
import { observeQueries, prisma, type ObservedQuery } from "../../db";

/**
 * `ensureAchievements()` runs on every boot and in the `beforeAll` of every
 * achievement suite. It used to issue a findUnique AND an unconditional
 * upsert per definition — two round trips times the whole catalogue, all of
 * them writes — which under a loaded full run pushed four suites past Jest's
 * 5 s hook timeout (achievements.cruiseScheduledLeak, railAchievements.recheck,
 * achievementsLodging/-Cruise.integration), while each was green alone.
 *
 * The property that matters is a count, not a duration: on a catalogue that
 * is already current, the call reads once and writes nothing; a drifted row
 * costs exactly one write.
 */
const WRITES = new Set(["create", "createMany", "update", "updateMany", "upsert"]);

async function watch(run: () => Promise<void>): Promise<ObservedQuery[]> {
  const seen: ObservedQuery[] = [];
  const stop = observeQueries((q) => {
    if (q.model === "Achievement") seen.push(q);
  });
  try {
    await run();
  } finally {
    stop();
  }
  return seen;
}

describe("ensureAchievements — work on a current catalogue", () => {
  beforeAll(async () => {
    await ensureAchievements();
  });

  it("reads the catalogue once and writes nothing when every row is current", async () => {
    const seen = await watch(ensureAchievements);
    expect(seen.filter((q) => WRITES.has(q.operation))).toEqual([]);
    expect(seen.length).toBeLessThanOrEqual(2);
  });

  it("rewrites exactly the one row whose definition drifted", async () => {
    const target = achievements[0];
    await prisma.achievement.update({
      where: { code: target.code },
      data: { icon: `${target.icon}-drifted` },
    });

    const seen = await watch(ensureAchievements);

    expect(seen.filter((q) => WRITES.has(q.operation))).toHaveLength(1);
    const row = await prisma.achievement.findUnique({ where: { code: target.code } });
    expect(row?.icon).toBe(target.icon);
  });
});
