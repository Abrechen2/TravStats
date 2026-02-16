import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import logger from '../utils/logger';
import { PatternSuggestion } from './patternAnalyzer';

/** Payload stored in analytics events for pattern suggestions */
interface PatternSuggestionPayload {
  field: string;
  pattern: string;
  confidence: number;
  examples: string[];
  issue: string;
  applied: boolean;
  appliedAt?: string;
  autoApplied?: boolean;
  createdAt?: string;
}

export interface PatternUpdate {
  id: string;
  field: string;
  pattern: string;
  confidence: number;
  applied: boolean;
  appliedAt?: Date;
  createdAt: Date;
  examples: string[];
  issue: string;
}

/**
 * Store pattern suggestions for review and auto-application
 */
export async function storePatternSuggestions(suggestions: PatternSuggestion[]): Promise<void> {
  try {
    for (const suggestion of suggestions) {
      // Check if similar pattern already exists (same field and pattern)
      const existing = await prisma.analyticsEvent.findFirst({
        where: {
          type: 'pattern_suggestion',
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Check if this exact pattern already exists
      let patternExists = false;
      if (existing) {
        const existingPayload = existing.payload as unknown as PatternSuggestionPayload;
        if (existingPayload.field === suggestion.field &&
            existingPayload.pattern === suggestion.pattern &&
            !existingPayload.applied) {
          patternExists = true;
        }
      }

      // Only store if confidence is high enough and pattern doesn't exist
      if (!patternExists && suggestion.confidence >= 0.7) {
        await prisma.analyticsEvent.create({
          data: {
            userId: 'system', // System-generated
            type: 'pattern_suggestion',
            payload: {
              field: suggestion.field,
              pattern: suggestion.pattern,
              confidence: suggestion.confidence,
              examples: suggestion.examples,
              issue: suggestion.issue,
              applied: false,
              createdAt: new Date().toISOString(),
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }

    logger.info(
      { count: suggestions.length },
      '[Pattern Updater] Pattern suggestions stored'
    );
  } catch (error) {
    logger.error({ error }, '[Pattern Updater] Failed to store pattern suggestions');
  }
}

/**
 * Get pending pattern suggestions with IDs
 */
export async function getPendingPatternSuggestions(): Promise<Array<PatternSuggestion & { id: string }>> {
  try {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        type: 'pattern_suggestion',
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });

    const suggestions: Array<PatternSuggestion & { id: string }> = [];
    for (const event of events) {
      const payload = event.payload as unknown as PatternSuggestionPayload;
      if (!payload.applied && payload.confidence >= 0.7) {
        suggestions.push({
          id: event.id,
          pattern: payload.pattern,
          field: payload.field,
          confidence: payload.confidence,
          examples: payload.examples || [],
          issue: payload.issue || '',
        });
      }
    }

    return suggestions;
  } catch (error) {
    logger.error({ error }, '[Pattern Updater] Failed to get pattern suggestions');
    return [];
  }
}

/**
 * Apply a pattern suggestion (update regex parser patterns)
 * This requires code changes, so we'll mark it as applied and log it
 */
export async function applyPatternSuggestion(
  patternId: string,
  autoApply: boolean = false
): Promise<{ success: boolean; message: string }> {
  try {
    const event = await prisma.analyticsEvent.findFirst({
      where: {
        type: 'pattern_suggestion',
        id: patternId,
      },
    });

    if (!event) {
      return { success: false, message: 'Pattern suggestion not found' };
    }

    const payload = event.payload as unknown as PatternSuggestionPayload;

    if (payload.applied) {
      return { success: false, message: 'Pattern already applied' };
    }

    // Mark as applied
    const updatedPayload: PatternSuggestionPayload = {
      ...payload,
      applied: true,
      appliedAt: new Date().toISOString(),
      autoApplied: autoApply,
    };
    await prisma.analyticsEvent.update({
      where: { id: event.id },
      data: {
        payload: updatedPayload as unknown as Prisma.InputJsonValue,
      },
    });

    logger.info(
      {
        patternId,
        field: payload.field,
        pattern: payload.pattern,
        autoApply,
      },
      '[Pattern Updater] Pattern suggestion applied'
    );

    // Note: Actual pattern update requires code changes
    // For now, we log it and mark as applied
    // In the future, this could trigger a code generation or hot-reload

    return {
      success: true,
      message: `Pattern for ${payload.field} marked as applied. Manual code update required.`,
    };
  } catch (error) {
    logger.error({ error, patternId }, '[Pattern Updater] Failed to apply pattern');
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Auto-apply high-confidence pattern suggestions
 */
export async function autoApplyHighConfidencePatterns(threshold: number = 0.9): Promise<number> {
  try {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        type: 'pattern_suggestion',
      },
    });

    let appliedCount = 0;
    for (const event of events) {
      const payload = event.payload as unknown as PatternSuggestionPayload;
      if (!payload.applied && payload.confidence >= threshold) {
        const result = await applyPatternSuggestion(event.id, true);
        if (result.success) {
          appliedCount++;
        }
      }
    }

    logger.info(
      { appliedCount, threshold },
      '[Pattern Updater] Auto-applied high-confidence patterns'
    );

    return appliedCount;
  } catch (error) {
    logger.error({ error }, '[Pattern Updater] Failed to auto-apply patterns');
    return 0;
  }
}

/**
 * Get pattern update statistics
 */
export async function getPatternUpdateStats(): Promise<{
  total: number;
  applied: number;
  pending: number;
  avgConfidence: number;
  byField: Record<string, number>;
}> {
  try {
    const events = await prisma.analyticsEvent.findMany({
      where: {
        type: 'pattern_suggestion',
      },
    });

    let applied = 0;
    let totalConfidence = 0;
    const byField: Record<string, number> = {};

    for (const event of events) {
      const payload = event.payload as unknown as PatternSuggestionPayload;
      if (payload.applied) applied++;
      totalConfidence += payload.confidence || 0;
      byField[payload.field] = (byField[payload.field] || 0) + 1;
    }

    return {
      total: events.length,
      applied,
      pending: events.length - applied,
      avgConfidence: events.length > 0 ? totalConfidence / events.length : 0,
      byField,
    };
  } catch (error) {
    logger.error({ error }, '[Pattern Updater] Failed to get pattern stats');
    return {
      total: 0,
      applied: 0,
      pending: 0,
      avgConfidence: 0,
      byField: {},
    };
  }
}

