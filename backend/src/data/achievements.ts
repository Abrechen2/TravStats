/**
 * Achievement definitions for TravStats
 * These are core application data that must always be available.
 *
 * The seed array is split across two sibling files (Part A, Part B) to
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

export interface AchievementDefinition {
  code: string;
  name: string;
  description: string;
  category: string;
  domain: 'flight' | 'cruise' | 'lodging' | 'shared';
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
];

/**
 * Ensure all achievements are present in the database
 * This function is idempotent and can be safely called multiple times
 * It will create missing achievements and update existing ones
 */
export async function ensureAchievements(): Promise<void> {
  logger.info({ operation: 'ensure_achievements_start', message: 'Ensuring achievements are present in database' });

  try {
    // Check if achievements already exist
    const existingCount = await prisma.achievement.count();

    if (existingCount === achievements.length) {
      logger.info({
        operation: 'ensure_achievements_already_present',
        message: `All achievements already present (${existingCount} achievements)`,
        context: { existingCount },
      });
      return;
    }

    if (existingCount > 0) {
      logger.info({
        operation: 'ensure_achievements_updating',
        message: `Found ${existingCount} existing achievements, ensuring all are present...`,
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
