/**
 * Historical Enrichment Scheduler
 *
 * Background job that processes historical enrichment candidates
 * for users who have auto-processing enabled.
 */

import cron from 'node-cron';
import { prisma } from '../db';
import logger from '../utils/logger';
import {
  getUserEnrichmentSettings,
  findEnrichmentCandidates,
  aggregateFlightData,
  createHistoricalEnrichment,
} from '../services/flightEnrichmentService';
import { applyPendingUpdate } from '../services/pendingUpdateService';

let schedulerRunning = false;
let schedulerTask: cron.ScheduledTask | null = null;

/**
 * Process historical enrichment for a single user
 */
export async function processUserHistoricalEnrichment(userId: string): Promise<{
  processed: number;
  created: number;
  skipped: number;
}> {
  try {
    const settings = await getUserEnrichmentSettings(userId);

    if (!settings || !settings.enabled) {
      return { processed: 0, created: 0, skipped: 0 };
    }

    // Find candidates
    const candidates = await findEnrichmentCandidates(userId, settings);

    if (candidates.length === 0) {
      return { processed: 0, created: 0, skipped: 0 };
    }

    // Limit to maxPerDay
    const candidatesToProcess = candidates.slice(0, settings.maxPerDay);

    // Mirror the live auto-update path: when the user has turned off the approval
    // gate for live API updates, historical enrichment should also auto-apply —
    // otherwise these rows sit as "pending" forever and the user never sees them
    // reflected on their flights.
    const userSettings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { autoUpdateRequireApproval: true },
    });
    const autoApply = userSettings?.autoUpdateRequireApproval === false;

    let created = 0;
    let skipped = 0;

    for (const candidate of candidatesToProcess) {
      try {
        // Get flight to enrich
        const flight = await prisma.flight.findUnique({
          where: { id: candidate.flightId },
        });

        if (!flight || !flight.flightNumber) {
          skipped++;
          continue;
        }

        // Aggregate data from similar flights — use the candidate's computed
        // enrichmentMode (slim for ≥1yr-old flights, full otherwise). minFlights
        // is left undefined so aggregateFlightData picks the mode-appropriate
        // threshold (3 for slim, 5 for full).
        const aggregatedData = await aggregateFlightData(
          flight.flightNumber,
          flight.id,
          undefined,
          candidate.enrichmentMode,
          userId
        );

        if (!aggregatedData) {
          skipped++;
          continue;
        }

        // Check confidence threshold
        if (aggregatedData.confidence < settings.minConfidence) {
          skipped++;
          continue;
        }

        // Create pending update
        const pendingUpdateId = await createHistoricalEnrichment(
          flight.id,
          aggregatedData
        );

        if (pendingUpdateId) {
          created++;

          if (autoApply) {
            const applied = await applyPendingUpdate(pendingUpdateId, userId);
            if (applied) {
              logger.info({
                operation: 'historical_enrichment_auto_applied',
                message: 'Auto-applied historical enrichment (requireApproval=false)',
                context: {
                  pendingUpdateId,
                  flightId: flight.id,
                  flightNumber: flight.flightNumber,
                  userId,
                },
              });
            } else {
              logger.warn({
                operation: 'historical_enrichment_auto_apply_failed',
                message: 'Auto-apply failed for historical enrichment',
                context: {
                  pendingUpdateId,
                  flightId: flight.id,
                  userId,
                },
              });
            }
          }
        } else {
          skipped++;
        }
      } catch (error) {
        logger.error({
          operation: 'process_historical_enrichment_candidate_error',
          message: 'Failed to process enrichment candidate',
          context: {
            userId,
            candidateId: candidate.flightId,
          },
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
          },
        });
        skipped++;
      }
    }

    logger.info({
      operation: 'process_user_historical_enrichment',
      message: 'Processed historical enrichment for user',
      context: {
        userId,
        processed: candidatesToProcess.length,
        created,
        skipped,
      },
    });

    return {
      processed: candidatesToProcess.length,
      created,
      skipped,
    };
  } catch (error) {
    logger.error({
      operation: 'process_user_historical_enrichment_error',
      message: 'Failed to process historical enrichment for user',
      context: { userId },
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return { processed: 0, created: 0, skipped: 0 };
  }
}

/**
 * Process historical enrichment for all eligible users
 */
export async function processAllUsersHistoricalEnrichment(): Promise<{
  usersProcessed: number;
  totalProcessed: number;
  totalCreated: number;
  totalSkipped: number;
}> {
  try {
    // Find all users with enrichment enabled
    const users = await prisma.userSettings.findMany({
      where: {
        historicalEnrichmentEnabled: true,
      },
      select: {
        userId: true,
      },
    });

    let totalProcessed = 0;
    let totalCreated = 0;
    let totalSkipped = 0;

    for (const userSettings of users) {
      const result = await processUserHistoricalEnrichment(userSettings.userId);
      totalProcessed += result.processed;
      totalCreated += result.created;
      totalSkipped += result.skipped;
    }

    logger.info({
      operation: 'process_all_users_historical_enrichment',
      message: 'Processed historical enrichment for all eligible users',
      context: {
        usersProcessed: users.length,
        totalProcessed,
        totalCreated,
        totalSkipped,
      },
    });

    return {
      usersProcessed: users.length,
      totalProcessed,
      totalCreated,
      totalSkipped,
    };
  } catch (error) {
    logger.error({
      operation: 'process_all_users_historical_enrichment_error',
      message: 'Failed to process historical enrichment for all users',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return {
      usersProcessed: 0,
      totalProcessed: 0,
      totalCreated: 0,
      totalSkipped: 0,
    };
  }
}

/**
 * Start the historical enrichment scheduler
 * Runs daily at 2 AM
 */
export function startHistoricalEnrichmentScheduler(): void {
  if (schedulerRunning) {
    logger.warn({
      operation: 'start_historical_enrichment_scheduler',
      message: 'Historical enrichment scheduler is already running',
    });
    return;
  }

  // Run daily at 2 AM
  const cronExpression = '0 2 * * *';

  logger.info({
    operation: 'start_historical_enrichment_scheduler',
    message: 'Starting historical enrichment scheduler',
    context: {
      cronExpression,
    },
  });

  schedulerTask = cron.schedule(cronExpression, async () => {
    try {
      logger.info({
        operation: 'historical_enrichment_scheduler_run',
        message: 'Running scheduled historical enrichment',
      });

      await processAllUsersHistoricalEnrichment();

      logger.info({
        operation: 'historical_enrichment_scheduler_run_complete',
        message: 'Scheduled historical enrichment completed',
      });
    } catch (error) {
      logger.error({
        operation: 'historical_enrichment_scheduler_run_error',
        message: 'Error during scheduled historical enrichment',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
    }
  });

  schedulerRunning = true;
}

/**
 * Stop the historical enrichment scheduler
 */
export function stopHistoricalEnrichmentScheduler(): void {
  if (!schedulerRunning || !schedulerTask) {
    return;
  }

  logger.info({
    operation: 'stop_historical_enrichment_scheduler',
    message: 'Stopping historical enrichment scheduler',
  });

  schedulerTask.stop();
  schedulerTask = null;
  schedulerRunning = false;
}

/**
 * Check if scheduler is running
 */
export function isHistoricalEnrichmentSchedulerRunning(): boolean {
  return schedulerRunning;
}
