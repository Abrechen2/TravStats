import { prisma } from "../../db";
import { sendLodgingCheckInReminder } from "../emailService";
import { stayTimes } from "../lodging/timesDto";
import { localDay, toLocal } from "../../shared/time/instant";
import logger from "../../utils/logger";

/**
 * The lodging half of the reminder scheduler — deliberately NOT an
 * "hours before" reminder (2026-09-27 redesign, decision 4): a check-in DAY
 * has no single departure instant to count hours from, so this fires once,
 * on the calendar day of check-in, at a fixed morning hour in the
 * PROPERTY'S OWN zone (never the server's or a guessed one).
 *
 * A stay abstains (no reminder at all) when its check-in has no DAY
 * precision or no resolved zone — the same "no zone, no wall-clock claim"
 * rule every other reminder in this module follows. Most manually-entered
 * stays carry only a date, not a time-of-day, so this reads the check-in
 * DAY (`stayTimes().checkIn`), not the optional `checkInAt` instant.
 */

const sentReminders = new Set<string>();

/** 08:00–08:59 local, in the property's own zone — dedup keeps it to one send. */
const MORNING_LOCAL_HOUR = 8;

const PRE_FILTER_PADDING_MS = 2 * 24 * 60 * 60 * 1000;

export async function checkLodgingCheckInReminders(now: Date): Promise<void> {
  const preFilterStart = new Date(now.getTime() - PRE_FILTER_PADDING_MS);
  const preFilterEnd = new Date(now.getTime() + PRE_FILTER_PADDING_MS);

  let stays;
  try {
    stays = await prisma.lodgingStay.findMany({
      where: {
        status: "scheduled",
        OR: [
          { checkInDate: { gte: preFilterStart, lte: preFilterEnd } },
          { checkIn: { gte: preFilterStart, lte: preFilterEnd } },
        ],
      },
      select: {
        id: true,
        tripId: true,
        checkIn: true,
        checkOut: true,
        checkInDate: true,
        checkOutDate: true,
        checkInAt: true,
        checkOutAt: true,
        stayZone: true,
        datePrecision: true,
        roomNumber: true,
        roomCategory: true,
        lodging: { select: { name: true, city: true, country: true } },
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
      domain: "lodging",
      error: { message: error instanceof Error ? error.message : "Unknown error" },
    });
    return;
  }

  for (const stay of stays) {
    const reminderKey = `lodging:${stay.id}-checkin`;
    if (sentReminders.has(reminderKey)) continue;

    const { user } = stay;
    // No lodging-specific notify flag exists yet (report); reuses the
    // "24h before" toggle, the closer fit of the two existing ones.
    const shouldSend = user.notificationEmail !== null && user.notifyBefore24h;
    if (!shouldSend) continue;

    // Everything from here reads row data that should be well-formed but is
    // not guaranteed to be (a malformed DATE value, a DTO edge case) — try/
    // catch the whole per-stay body, like the other three checkers do around
    // their own DTO + send calls, so one bad row cannot stop the batch.
    try {
      const times = stayTimes(stay);
      const checkIn = times.checkIn;
      if (!checkIn || checkIn.precision !== "day" || !checkIn.zone) continue;

      const todayThere = localDay(now, checkIn.zone);
      if (todayThere !== checkIn.date) continue;

      const localHour = Number(toLocal(now, checkIn.zone).local.slice(11, 13));
      if (localHour !== MORNING_LOCAL_HOUR) continue;

      await sendLodgingCheckInReminder(
        {
          id: stay.id,
          tripId: stay.tripId,
          lodgingName: stay.lodging.name,
          city: stay.lodging.city,
          country: stay.lodging.country,
          roomNumber: stay.roomNumber,
          roomCategory: stay.roomCategory,
          checkInAt: times.checkInAt,
          checkInDay: checkIn,
        },
        { notificationEmail: user.notificationEmail, settingsData: user.settings?.data ?? null }
      );
      sentReminders.add(reminderKey);
    } catch (error) {
      logger.error({
        operation: "reminder_scheduler_send_failed",
        domain: "lodging",
        stayId: stay.id,
        error: { message: error instanceof Error ? error.message : "Unknown error" },
      });
    }
  }
}
