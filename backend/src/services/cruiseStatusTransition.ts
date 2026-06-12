/**
 * Auto-transition past cruises out of "scheduled".
 *
 * Cruise counterpart to `transitionZombieFlights` (flightAutoUpdate.ts):
 * without it, a cruise whose end date has long passed stays "Geplant"
 * forever — the list view misleads and the cruise never contributes to
 * completed-trip semantics. Conservative by design:
 *   - Only touches cruises whose endDate + 48h < now (generous slack
 *     for timezone ambiguity around disembarkation day).
 *   - Only flips scheduled → flown; cancelled/historical are never
 *     touched, and user-set statuses stay as set.
 */

import { prisma } from '../db';
import logger from '../utils/logger';

const PAST_CRUISE_CUTOFF_HOURS = 48;

export async function transitionPastCruises(): Promise<number> {
  const cutoff = new Date(Date.now() - PAST_CRUISE_CUTOFF_HOURS * 60 * 60 * 1000);

  try {
    const result = await prisma.cruise.updateMany({
      where: {
        status: 'scheduled',
        endDate: { not: null, lt: cutoff },
      },
      data: { status: 'flown' },
    });

    if (result.count > 0) {
      logger.info({
        operation: 'past_cruises_transitioned',
        message: `Auto-flipped ${result.count} past scheduled cruises to completed`,
        context: { cutoffHours: PAST_CRUISE_CUTOFF_HOURS, count: result.count },
      });
    }

    return result.count;
  } catch (error) {
    logger.error({
      operation: 'past_cruises_transition_error',
      message: 'Failed to transition past cruises',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    return 0;
  }
}
