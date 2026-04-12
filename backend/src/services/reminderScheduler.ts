import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { prisma } from '../db';
import { sendFlightReminder } from './emailService';
import logger from '../utils/logger';

// Track sent reminders to avoid duplicates within the same process lifetime.
// Key format: `${flightId}-${hoursKey}` where hoursKey is '24h' or '2h'
const sentReminders = new Set<string>();

let scheduledTask: ScheduledTask | null = null;

async function checkAndSendReminders(): Promise<void> {
  logger.debug({ operation: 'reminder_scheduler_run', message: 'Checking flight reminders' });

  const now = new Date();

  // Windows for each reminder type (departure within hoursAhead ± 15 min)
  const windows: Array<{ hoursAhead: number; key: string }> = [
    { hoursAhead: 24, key: '24h' },
    { hoursAhead: 2, key: '2h' },
  ];

  for (const { hoursAhead, key } of windows) {
    const windowStart = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000 - 15 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000 + 15 * 60 * 1000);

    let flights: Array<{
      id: string;
      flightNumber: string | null;
      depName: string | null;
      depIata: string | null;
      arrName: string | null;
      arrIata: string | null;
      departureTime: Date | null;
      userId: string;
      user: {
        notificationEmail: string | null;
        notifyBefore24h: boolean;
        notifyBefore2h: boolean;
      };
    }>;

    try {
      flights = await prisma.flight.findMany({
        where: {
          status: 'scheduled',
          departureTime: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
        include: {
          user: {
            select: {
              notificationEmail: true,
              notifyBefore24h: true,
              notifyBefore2h: true,
            },
          },
        },
      });
    } catch (error) {
      logger.error({
        operation: 'reminder_scheduler_query_failed',
        hoursAhead,
        error: { message: error instanceof Error ? error.message : 'Unknown error' },
      });
      continue;
    }

    for (const flight of flights) {
      const reminderKey = `${flight.id}-${key}`;

      if (sentReminders.has(reminderKey)) {
        continue;
      }

      const { user } = flight;

      const shouldSend =
        user.notificationEmail !== null &&
        ((key === '24h' && user.notifyBefore24h) || (key === '2h' && user.notifyBefore2h));

      if (!shouldSend) {
        continue;
      }

      try {
        await sendFlightReminder(flight, user, hoursAhead);
        sentReminders.add(reminderKey);
      } catch (error) {
        logger.error({
          operation: 'reminder_scheduler_send_failed',
          flightId: flight.id,
          hoursAhead,
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        });
        // Do not add to sentReminders — allow retry on next run
      }
    }
  }
}

export function startReminderScheduler(): void {
  if (scheduledTask) {
    logger.warn({
      operation: 'reminder_scheduler_already_running',
      message: 'Reminder scheduler is already running',
    });
    return;
  }

  // Run every 15 minutes
  scheduledTask = cron.schedule('*/15 * * * *', () => {
    checkAndSendReminders().catch((error: unknown) => {
      logger.error({
        operation: 'reminder_scheduler_unhandled_error',
        error: { message: error instanceof Error ? error.message : 'Unknown error' },
      });
    });
  });

  logger.info({ operation: 'reminder_scheduler_started', message: 'Flight reminder scheduler started (every 15 min)' });
}

export function stopReminderScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info({ operation: 'reminder_scheduler_stopped', message: 'Flight reminder scheduler stopped' });
  }
}
