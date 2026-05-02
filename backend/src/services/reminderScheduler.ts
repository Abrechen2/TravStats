import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { prisma } from '../db';
import { sendFlightReminder } from './emailService';
import { getCachedAirport } from './airportCache';
import { normalizeFlightTimeUtc, type FlightTimeSemantics } from '../utils/timezone';
import logger from '../utils/logger';

// Track sent reminders to avoid duplicates within the same process lifetime.
// Key format: `${flightId}-${hoursKey}` where hoursKey is '24h' or '2h'
const sentReminders = new Set<string>();

let scheduledTask: ScheduledTask | null = null;

// DB pre-filter is widened by this much beyond the precise reminder window
// to catch LEGACY_FAKE_UTC rows whose stored value can be off by up to ~14h
// from the real UTC instant (extreme airport offsets like Pacific). 16 hours
// covers everything globally with a comfortable margin.
const PRE_FILTER_PADDING_MS = 16 * 60 * 60 * 1000;

async function resolveDepTz(iata: string | null, icao: string | null): Promise<string | null> {
  for (const code of [iata, icao]) {
    if (!code) continue;
    try {
      const airport = await getCachedAirport(code);
      if (airport?.timezone) return airport.timezone;
    } catch {
      // ignore lookup error, try next code
    }
  }
  return null;
}

async function checkAndSendReminders(): Promise<void> {
  logger.debug({ operation: 'reminder_scheduler_run', message: 'Checking flight reminders' });

  const now = new Date();

  // Windows for each reminder type (departure within hoursAhead ± 15 min).
  const windows: Array<{ hoursAhead: number; key: string }> = [
    { hoursAhead: 24, key: '24h' },
    { hoursAhead: 2, key: '2h' },
  ];

  for (const { hoursAhead, key } of windows) {
    const target = now.getTime() + hoursAhead * 60 * 60 * 1000;
    const preciseStart = target - 15 * 60 * 1000;
    const preciseEnd = target + 15 * 60 * 1000;
    // Pre-filter is wider so we can catch LEGACY rows whose stored timestamp
    // is offset from real UTC by the airport's tz; we then re-check the
    // normalized UTC against preciseStart/End below.
    const preFilterStart = new Date(target - PRE_FILTER_PADDING_MS);
    const preFilterEnd = new Date(target + PRE_FILTER_PADDING_MS);

    let flights: Array<{
      id: string;
      flightNumber: string | null;
      depName: string | null;
      depIata: string | null;
      depIcao: string | null;
      arrName: string | null;
      arrIata: string | null;
      departureTime: Date | null;
      depTimeSemantics: string;
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
            gte: preFilterStart,
            lte: preFilterEnd,
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

      // Normalise the stored departure to a real UTC instant before comparing
      // against the precise reminder window. Pure-UTC rows are returned as-is;
      // LEGACY rows are re-interpreted via the airport's tz. This is the fix
      // for reminders previously firing 1–2h off for manual/parser entries.
      const semantics = flight.depTimeSemantics as FlightTimeSemantics;
      const depTz =
        semantics === 'UTC' ? null : await resolveDepTz(flight.depIata, flight.depIcao);
      const realDeparture = normalizeFlightTimeUtc(flight.departureTime, semantics, depTz);
      if (!realDeparture) continue;

      const realMs = realDeparture.getTime();
      if (realMs < preciseStart || realMs > preciseEnd) continue;

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
