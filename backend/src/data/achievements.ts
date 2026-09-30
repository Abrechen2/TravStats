/**
 * Achievement definitions for TravStats
 * These are core application data that must always be available.
 *
 * The seed array is split across sibling files (Part A through Part J) to
 * keep every source file under the 800-line limit mandated by CLAUDE.md.
 * This file composes them into the single `achievements` export consumed
 * by the rest of the codebase.
 */

import { prisma } from "../db";
import logger from "../utils/logger";
import { seedsPartA } from "./achievementSeeds/partA";
import { seedsPartB } from "./achievementSeeds/partB";
import { seedsPartC } from "./achievementSeeds/partC";
import { seedsPartD } from "./achievementSeeds/partD";
import { seedsPartE } from "./achievementSeeds/partE";
import { seedsPartF } from "./achievementSeeds/partF";
import { seedsPartG } from "./achievementSeeds/partG";
import { seedsPartH } from "./achievementSeeds/partH";
import { seedsPartI } from "./achievementSeeds/partI";
import { seedsPartJ } from "./achievementSeeds/partJ";

export interface AchievementDefinition {
  code: string;
  name: string;
  description: string;
  category: string;
  domain: "flight" | "cruise" | "lodging" | "poi" | "roadtrip" | "rail" | "shared";
  icon: string;
  tier: string;
  requirement: number;
  requirementType: string;
  points: number;
  isHidden?: boolean;
}

export const achievements: AchievementDefinition[] = [
  ...seedsPartA,
  ...seedsPartB,
  ...seedsPartC,
  ...seedsPartD,
  ...seedsPartE,
  ...seedsPartF,
  ...seedsPartG,
  ...seedsPartH,
  ...seedsPartI,
  ...seedsPartJ,
];

type DefinitionFields = Omit<Required<AchievementDefinition>, "code">;

/** The columns a seed definition owns — everything but the key. */
function definitionFields(a: AchievementDefinition): DefinitionFields {
  return {
    name: a.name,
    description: a.description,
    category: a.category,
    domain: a.domain,
    icon: a.icon,
    tier: a.tier,
    requirement: a.requirement,
    requirementType: a.requirementType,
    points: a.points,
    isHidden: a.isHidden ?? false,
  };
}

function differs(row: Record<string, unknown>, wanted: DefinitionFields): boolean {
  return (Object.keys(wanted) as Array<keyof DefinitionFields>).some(
    (key) => row[key] !== wanted[key]
  );
}

/**
 * Ensure all achievements are present in the database
 * This function is idempotent and can be safely called multiple times
 * It will create missing achievements and update existing ones
 */
export async function ensureAchievements(): Promise<void> {
  logger.info({
    operation: "ensure_achievements_start",
    message: "Ensuring achievements are present in database",
  });

  try {
    // One read, then a write only where a row is missing or differs. This
    // used to be a findUnique plus an unconditional upsert per definition:
    // ~600 round trips, all writes, on every boot and in the beforeAll of
    // every achievement suite — measured at 0.9 s on an idle box and past
    // Jest's 5 s hook timeout under a loaded full run.
    // `data/__tests__/ensureAchievements.queries.test.ts` pins the count.
    const stored = new Map(
      (await prisma.achievement.findMany()).map((row) => [row.code, row] as const)
    );
    const existingCount = stored.size;

    // NO early return on a matching count: seed edits that only change
    // points, tier or copy (no new codes) keep the row count identical, and
    // the old `existingCount === achievements.length` short-circuit silently
    // froze such edits forever on any install whose count happened to match.
    // Several seed comments rely on "upserted on every boot" being true —
    // this loop is what makes it true: every drifted field is rewritten.
    if (existingCount > 0) {
      logger.info({
        operation: "ensure_achievements_updating",
        message: `Found ${existingCount} existing achievements, syncing all definitions...`,
        context: { existingCount, expectedCount: achievements.length },
      });
    }

    let created = 0;
    let updated = 0;

    for (const achievement of achievements) {
      const current = definitionFields(achievement);
      const row = stored.get(achievement.code);
      if (!row) {
        await prisma.achievement.create({ data: { code: achievement.code, ...current } });
        created++;
      } else if (differs(row, current)) {
        await prisma.achievement.update({ where: { code: achievement.code }, data: current });
        updated++;
      }
    }

    logger.info({
      operation: "ensure_achievements_processed",
      message: `Processed ${achievements.length} achievements`,
      context: { total: achievements.length, created, updated },
    });

    // Show summary by category
    const categoryCounts = achievements.reduce(
      (acc, ach) => {
        acc[ach.category] = (acc[ach.category] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    logger.info({
      operation: "ensure_achievements_by_category",
      message: "Achievements by category",
      context: { categoryCounts },
    });

    logger.info({
      operation: "ensure_achievements_complete",
      message: "Achievement initialization completed successfully",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error({
      operation: "ensure_achievements_error",
      message: "Error ensuring achievements",
      error: {
        message: errorMessage,
        stack: errorStack,
      },
    });
    throw error;
  }
}
