import { prisma } from "../../db";
import { sendLodgingCheckInReminder } from "../emailService";
import { stayTimes } from "../lodging/timesDto";
import { profileZoneFromSettings } from "../../shared/time/profileZone";
import { daysBetween } from "../../shared/time/localDate";
import logger from "../../utils/logger";
import { entryReminderMessage } from "../notifications/messages";
import { lodgingKey } from "./eligibility";
import { sendDueReminder } from "./dispatch";
import { anchorFromLocal, isDue } from "./due";
import { activeLeadHours, leadsFor, REMINDER_USER_SELECT } from "./prefs";

/**
 * The lodging half of the reminder scheduler. A stay's anchor is its CHECK-IN
 * instant, and a reminder is `lead` hours before it like every other domain:
 *
 *   1. the stay stores a check-in time and a zone -> that instant;
 *   2. a check-in day without a time              -> 15:00 in the STAY's zone;
 *   3. a stay without a zone                      -> 15:00 in the ACCOUNT's zone
 *      (the profile zone, UTC when the user never set one).
 *
 * (Until package 11 this fired once at 08:00 on the check-in day in the
 * property's zone. The new rule replaces it.) A stay with no check-in DAY
 * (month/year precision, no date) abstains: no day, no anchor. The local time
 * is resolved in the IANA zone and the lead is subtracted in UTC, so a DST
 * change between the reminder and the check-in does not shift it.
 */

const DEFAULT_CHECK_IN_TIME = "15:00";

const PRE_FILTER_PADDING_MS = 2 * 24 * 60 * 60 * 1000;

/** The check-in instant of a stay, per the rule above; null when the stay has no check-in day. */
export function lodgingAnchor(
  stay: Parameters<typeof stayTimes>[0],
  accountZone: string
): { anchor: Date; zone: string } | null {
  const checkIn = stayTimes(stay).checkIn;
  if (!checkIn || checkIn.precision !== "day") return null;
  if (stay.checkInAt && stay.stayZone) return { anchor: stay.checkInAt, zone: stay.stayZone };
  const zone = stay.stayZone ?? accountZone;
  return { anchor: anchorFromLocal(checkIn.date, DEFAULT_CHECK_IN_TIME, zone), zone };
}

export async function checkLodgingCheckInReminders(now: Date): Promise<void> {
  const maxLead = Math.max(...(await activeLeadHours()));
  const preFilterStart = new Date(now.getTime() - PRE_FILTER_PADDING_MS);
  const preFilterEnd = new Date(now.getTime() + maxLead * 3_600_000 + PRE_FILTER_PADDING_MS);

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
        freeCancellationUntil: true,
        freeCancellationOn: true,
        freeCancellationZone: true,
        paymentDueOn: true,
        roomNumber: true,
        roomCategory: true,
        board: true,
        guests: true,
        nights: true,
        bookingReference: true,
        lodgingId: true,
        lodging: { select: { name: true, address: true, city: true, country: true } },
        user: REMINDER_USER_SELECT,
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
    const { user } = stay;
    const leads = leadsFor(user, "lodging");
    if (leads.length === 0) continue;

    // Everything from here reads row data that should be well-formed but is
    // not guaranteed to be (a malformed DATE value, a DTO edge case) — try/
    // catch the whole per-stay body so one bad row cannot stop the batch.
    try {
      const accountZone = profileZoneFromSettings(user.settings?.data).zone;
      const resolved = lodgingAnchor(stay, accountZone);
      if (!resolved) continue;
      const { anchor, zone } = resolved;
      const times = stayTimes(stay);
      const checkIn = times.checkIn!;

      // The dates win wherever they can answer; the stored figure covers a
      // stay whose check-out day is not known. Null stays null — never 0.
      const checkOut = times.checkOut?.precision === "day" ? times.checkOut : null;
      const nights = checkOut ? daysBetween(checkIn.date, checkOut.date) : stay.nights;

      for (const hours of leads) {
        if (!isDue(anchor, hours, now)) continue;
        await sendDueReminder({
          user,
          domain: "lodging",
          entryId: stay.id,
          lodgingId: stay.lodgingId,
          tripId: stay.tripId,
          hours,
          anchorAt: anchor,
          anchorKey: lodgingKey(stay, accountZone),
          now,
          render: (locale) =>
            entryReminderMessage(
              "lodging",
              {
                label: stay.lodging.name,
                detail:
                  [stay.lodging.address, stay.lodging.city].filter(Boolean).join(", ") || null,
                at: anchor,
                zone,
              },
              hours,
              locale
            ),
          sendMail: () =>
            sendLodgingCheckInReminder(
              {
                id: stay.id,
                lodgingId: stay.lodgingId,
                tripId: stay.tripId,
                lodgingName: stay.lodging.name,
                address: stay.lodging.address,
                city: stay.lodging.city,
                country: stay.lodging.country,
                roomNumber: stay.roomNumber,
                roomCategory: stay.roomCategory,
                board: stay.board,
                guests: stay.guests,
                nights,
                bookingReference: stay.bookingReference,
                checkInAt: times.checkInAt,
                checkInDay: checkIn,
                checkOutDay: checkOut,
              },
              {
                notificationEmail: user.notificationEmail as string,
                settingsData: user.settings?.data ?? null,
              }
            ),
        });
      }
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
