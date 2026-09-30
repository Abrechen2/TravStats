import { prisma } from "../../db";
import { sendRailReminder } from "../emailService";
import { serializeTime, type TimePrecision } from "../../shared/time/wire";
import logger from "../../utils/logger";

/**
 * The rail half of the departure-reminder scheduler. `RailJourney` stores a
 * real UTC instant in `departureTime` from the day it was built (no
 * LEGACY_FAKE_UTC class here, unlike flights), so the window compare needs no
 * normalisation step at all — the simplest of the three.
 */

const sentReminders = new Set<string>();

const REMINDER_WINDOWS = [
  { hoursAhead: 24, key: "24h" },
  { hoursAhead: 2, key: "2h" },
] as const;

const isPrecision = (value: string | null): value is TimePrecision =>
  value !== null && ["minute", "day", "month", "year", "unknown"].includes(value);

export async function checkRailReminders(now: Date): Promise<void> {
  for (const { hoursAhead, key } of REMINDER_WINDOWS) {
    const target = now.getTime() + hoursAhead * 60 * 60 * 1000;
    const preciseStart = new Date(target - 15 * 60 * 1000);
    const preciseEnd = new Date(target + 15 * 60 * 1000);

    let journeys;
    try {
      journeys = await prisma.railJourney.findMany({
        where: {
          status: "scheduled",
          departureTime: { gte: preciseStart, lte: preciseEnd },
        },
        select: {
          id: true,
          tripId: true,
          operator: true,
          trainCategory: true,
          trainNumber: true,
          coach: true,
          seat: true,
          depStationName: true,
          depTimezone: true,
          depPrecision: true,
          arrStationName: true,
          arrTimezone: true,
          arrPrecision: true,
          departureTime: true,
          arrivalTime: true,
          userId: true,
          user: {
            select: {
              notificationEmail: true,
              notifyBefore24h: true,
              notifyBefore2h: true,
              settings: { select: { data: true } },
            },
          },
        },
      });
    } catch (error) {
      logger.error({
        operation: "reminder_scheduler_query_failed",
        domain: "rail",
        hoursAhead,
        error: { message: error instanceof Error ? error.message : "Unknown error" },
      });
      continue;
    }

    for (const journey of journeys) {
      const reminderKey = `rail:${journey.id}-${key}`;
      if (sentReminders.has(reminderKey)) continue;

      const { user } = journey;
      const shouldSend =
        user.notificationEmail !== null &&
        ((key === "24h" && user.notifyBefore24h) || (key === "2h" && user.notifyBefore2h));
      if (!shouldSend) continue;

      try {
        const depPrecision: TimePrecision = isPrecision(journey.depPrecision)
          ? journey.depPrecision
          : "minute";
        const arrPrecision: TimePrecision = isPrecision(journey.arrPrecision)
          ? journey.arrPrecision
          : "minute";
        const departure = serializeTime(journey.departureTime, journey.depTimezone, depPrecision);
        const arrival = journey.arrivalTime
          ? serializeTime(journey.arrivalTime, journey.arrTimezone, arrPrecision)
          : null;

        await sendRailReminder(
          {
            id: journey.id,
            tripId: journey.tripId,
            operator: journey.operator,
            trainCategory: journey.trainCategory,
            trainNumber: journey.trainNumber,
            coach: journey.coach,
            seat: journey.seat,
            depStationName: journey.depStationName,
            arrStationName: journey.arrStationName,
            departure,
            arrival,
          },
          { notificationEmail: user.notificationEmail, settingsData: user.settings?.data ?? null },
          hoursAhead
        );
        sentReminders.add(reminderKey);
      } catch (error) {
        logger.error({
          operation: "reminder_scheduler_send_failed",
          domain: "rail",
          journeyId: journey.id,
          hoursAhead,
          error: { message: error instanceof Error ? error.message : "Unknown error" },
        });
      }
    }
  }
}
