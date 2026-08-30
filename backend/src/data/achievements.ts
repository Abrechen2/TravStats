/**
 * Achievement definitions for TravStats
 * These are core application data that must always be available.
 *
 * The seed array is split across sibling files (Part A through Part G) to
 * keep every source file under the 800-line limit mandated by CLAUDE.md.
 * This file composes them into the single `achievements` export consumed
 * by the rest of the codebase.
 */

import { prisma } from '../db';
import logger from '../utils/logger';
import { seedsPartA } from './achievementSeeds/partA';
import { seedsPartB } from './achievementSeeds/partB';
import { seedsPartC } from './achievementSeeds/partC';
import { seedsPartD } from './achievementSeeds/partD';
import { seedsPartE } from './achievementSeeds/partE';
import { seedsPartF } from './achievementSeeds/partF';
import { seedsPartG } from './achievementSeeds/partG';
import { seedsPartH } from './achievementSeeds/partH';

export interface AchievementDefinition {
  code: string;
  name: string;
  description: string;
  category: string;
  domain: 'flight' | 'cruise' | 'lodging' | 'poi' | 'shared';
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
];

/**
 * Ensure all achievements are present in the database
 * This function is idempotent and can be safely called multiple times
 * It will create missing achievements and update existing ones
 */
export async function ensureAchievements(): Promise<void> {
  logger.info({ operation: 'ensure_achievements_start', message: 'Ensuring achievements are present in database' });

  try {
    const existingCount = await prisma.achievement.count();

    // NO early return on a matching count: seed edits that only change
    // points, tier or copy (no new codes) keep the row count identical, and
    // the old `existingCount === achievements.length` short-circuit silently
    // froze such edits forever on any install whose count happened to match.
    // Several seed comments rely on "upserted on every boot" being true —
    // this loop is what makes it true.
    if (existingCount > 0) {
      logger.info({
        operation: 'ensure_achievements_updating',
        message: `Found ${existingCount} existing achievements, upserting all definitions...`,
        context: { existingCount, expectedCount: achievements.length },
      });
    }

    // Upsert all achievements
    let created = 0;
    let updated = 0;

    for (const achievement of achievements) {
      // Check if achievement already exists
      const existing = await prisma.achievement.findUnique({
        where: { code: achievement.code },
      });

      await prisma.achievement.upsert({
        where: { code: achievement.code },
        update: {
          name: achievement.name,
          description: achievement.description,
          category: achievement.category,
          domain: achievement.domain,
          icon: achievement.icon,
          tier: achievement.tier,
          requirement: achievement.requirement,
          requirementType: achievement.requirementType,
          points: achievement.points,
          isHidden: achievement.isHidden || false,
        },
        create: achievement,
      });

      if (existing) {
        updated++;
      } else {
        created++;
      }
    }

    logger.info({
      operation: 'ensure_achievements_processed',
      message: `Processed ${achievements.length} achievements`,
      context: { total: achievements.length, created, updated },
    });

    // Show summary by category
    const categoryCounts = achievements.reduce((acc, ach) => {
      acc[ach.category] = (acc[ach.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    logger.info({
      operation: 'ensure_achievements_by_category',
      message: 'Achievements by category',
      context: { categoryCounts },
    });

    logger.info({
      operation: 'ensure_achievements_complete',
      message: 'Achievement initialization completed successfully',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error({
      operation: 'ensure_achievements_error',
      message: 'Error ensuring achievements',
      error: {
        message: errorMessage,
        stack: errorStack,
      },
    });
    throw error;
  }
}
