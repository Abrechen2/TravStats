import { prisma } from "../../../../db";
import type { EvidenceScope } from "../../../../shared/evidence";
import { BADGE_PROOF_TYPES, badgeProofKey } from "../../../../shared/badgeEvidence";
import { runDemoSeed } from "../../../../seedDemoAccount";
import { checkAndUpdateAchievements } from "../../../../utils/achievements";
import { resolveMetricEvidence } from "../../metricEvidence";
import { assertDistinctInvariant, assertSumInvariant } from "../../__tests__/invariants";
import { observeQueries } from "../../../../db";
import { coreArraysFor } from "../badgeFamiliesCore";
import { loadBadgeFamily } from "../badgeFamiliesDomains";

/**
 * forgejo#265 — every badge that opens its own proof answers with the badge's
 * own progress, and its rows add up to it. Measured on the standard demo
 * account, which fills every domain: the progress the badge check stored is
 * the reference (a held badge stores its requirement, so the proof must reach
 * at least that).
 */
const ALL: EvidenceScope = { period: { kind: "allTime" } };
const PAGE = { offset: 0, limit: 500 };

describe("badge proofs on the demo account", () => {
  let userId: string;

  beforeAll(async () => {
    userId = (await runDemoSeed()).userId;
    await checkAndUpdateAchievements(userId);
  }, 300_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "demo" } });
  });

  it("answers every proof with the badge's progress, its rows adding up to it", async () => {
    const rows = await prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
    });
    const stored = new Map<string, { progress: number; requirement: number }>();
    for (const r of rows) {
      const type = r.achievement.requirementType;
      // The strictest of a type's rungs: the one not yet reached, else the top.
      const prior = stored.get(type);
      if (!prior || r.achievement.requirement > prior.requirement) {
        stored.set(type, { progress: r.progress, requirement: r.achievement.requirement });
      }
    }
    const disagree: string[] = [];
    let opened = 0;
    for (const type of BADGE_PROOF_TYPES) {
      // No stored row: the badge check measured nothing, so neither may the proof.
      const reference = stored.get(type) ?? { progress: 0, requirement: Infinity };
      const res = await resolveMetricEvidence(userId, badgeProofKey(type), ALL, PAGE);
      if (!res) throw new Error(`${type} is not served`);
      if (type === "countries") assertDistinctInvariant(res);
      else assertSumInvariant(res, Math.round);
      const value = res.measure.value ?? 0;
      const held = reference.progress >= reference.requirement;
      if (held ? value < reference.requirement : value !== reference.progress) {
        disagree.push(
          `${type}: proof ${value}, badge ${reference.progress}/${reference.requirement}`
        );
      }
      if (value > 0) {
        opened += 1;
        expect([type, res.entries.length > 0]).toEqual([type, true]);
      }
    }
    expect(disagree).toEqual([]);
    // The demo fills every domain: a good share of the badges have entries to show.
    expect(opened).toBeGreaterThan(80);
  }, 600_000);

  // Security review: `progress` is evaluated many times per request, so it
  // must fold the rows the family loaded and nothing else — no query. And a
  // family that declares per-row shares must have them add up.
  it("folds without a single query, and declared shares add up to the progress", async () => {
    const queries: string[] = [];
    for (const type of BADGE_PROOF_TYPES.filter((t) => t !== "countries")) {
      const rule = { requirementType: type, requirement: 1 };
      const family = await loadBadgeFamily(userId, rule, coreArraysFor(type));
      if (!family) throw new Error(`${type} has no family`);
      const stop = observeQueries((q) => queries.push(`${type}: ${q.model}.${q.operation}`));
      try {
        await family.progress(family.rows);
        await family.progress(family.rows.slice(0, Math.ceil(family.rows.length / 2)));
        await family.progress(family.rows.slice(0, 1));
      } finally {
        stop();
      }
      if (family.share) {
        const total = family.rows.map(family.share).reduce((a, b) => a + b, 0);
        expect([type, total]).toEqual([type, await family.progress(family.rows)]);
      }
    }
    expect(queries).toEqual([]);
  }, 600_000);
});
