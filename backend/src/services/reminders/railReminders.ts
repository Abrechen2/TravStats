import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { departureClockedWhere } from "../../shared/railClock";
import { groupRailLegs } from "../../shared/railJourneyGrouping";
import { sendRailReminder } from "../emailService";
import type { RailReminderData } from "../email/reminderContent";
import { RAIL_GROUPING_SELECT } from "../rail/railGroupingSelect";
import { serializeTime, type TimePrecision } from "../../shared/time/wire";
import logger from "../../utils/logger";
import { entryReminderMessage } from "../notifications/messages";
import { sendDueReminder } from "./dispatch";
import { dueAnchorRange, isDue } from "./due";
import { activeLeadHours, leadsFor, REMINDER_USER_SELECT } from "./prefs";

/**
 * The rail half of the departure-reminder scheduler. `RailJourney` stores a
 * real UTC instant in `departureTime` from the day it was built (no
 * LEGACY_FAKE_UTC class here, unlike flights), so the window compare needs no
 * normalisation step at all — the simplest of the three.
 *
 * A reminder is per RIDE, not per train (forgejo#210): Augsburg → München
 * (ICE 911) → Salzburg (EC 115) is one journey and one mail, which used to be
 * two "in 24h" mails. Which trains form a ride is `groupRailLegs`' answer —
 * the same rule the rail list draws with, never a second one here. A ride's
 * windows key on its FIRST departure, and it is remembered by its first leg's
 * id, so no ride is announced twice and no later train of it on its own.
 */

const isPrecision = (value: string | null): value is TimePrecision =>
  value !== null && ["minute", "day", "month", "year", "unknown"].includes(value);

/** What the mail shows of a train, on top of the columns the grouping rule reads. */
const LEG_SELECT = {
  ...RAIL_GROUPING_SELECT,
  tripId: true,
  operator: true,
  trainCategory: true,
  trainNumber: true,
  coach: true,
  seat: true,
  travelClass: true,
  bookingReference: true,
  depTimezone: true,
  arrTimezone: true,
} as const;

type ReminderLegRow = Prisma.RailJourneyGetPayload<{ select: typeof LEG_SELECT }>;

/** A train as the mail shows it: both ends on their station's own clock. */
function toReminderLeg(leg: ReminderLegRow): RailReminderData {
  const depPrecision: TimePrecision = isPrecision(leg.depPrecision) ? leg.depPrecision : "minute";
  const arrPrecision: TimePrecision = isPrecision(leg.arrPrecision) ? leg.arrPrecision : "minute";
  return {
    id: leg.id,
    tripId: leg.tripId,
    operator: leg.operator,
    trainCategory: leg.trainCategory,
    trainNumber: leg.trainNumber,
    coach: leg.coach,
    seat: leg.seat,
    travelClass: leg.travelClass,
    bookingReference: leg.bookingReference,
    depStationName: leg.depStationName,
    arrStationName: leg.arrStationName,
    departure: serializeTime(leg.departureTime, leg.depTimezone, depPrecision),
    arrival: leg.arrivalTime ? serializeTime(leg.arrivalTime, leg.arrTimezone, arrPrecision) : null,
  };
}

/**
 * The rides whose FIRST train leaves inside [start, end]. The window query
 * finds the trains that leave then; their bookings' other scheduled trains
 * are read too, because only the whole booking tells whether a train in the
 * window opens a ride or continues one that left earlier — the latter's
 * reminder was its first train's, and it gets none of its own.
 */
async function dueRides(start: Date, end: Date) {
  const inWindow = await prisma.railJourney.findMany({
    where: {
      status: "scheduled",
      departureTime: { gte: start, lte: end },
      // A date-only ride is stored at the start of its day; "leaves in
      // 2 hours" would be a time nobody printed (forgejo#132 item 17).
      ...departureClockedWhere(),
    },
    select: { ...LEG_SELECT, userId: true, user: REMINDER_USER_SELECT },
  });
  const candidates = new Map(inWindow.map((leg) => [leg.id, leg]));
  const bookingIds = [
    ...new Set(inWindow.map((leg) => leg.bookingId).filter((id): id is string => id !== null)),
  ];
  const siblings =
    bookingIds.length === 0
      ? []
      : await prisma.railJourney.findMany({
          where: {
            status: "scheduled",
            bookingId: { in: bookingIds },
            userId: { in: [...new Set(inWindow.map((leg) => leg.userId))] },
            id: { notIn: [...candidates.keys()] },
          },
          select: LEG_SELECT,
        });

  return groupRailLegs<ReminderLegRow>([...inWindow, ...siblings]).flatMap((ride) => {
    // A ride is due only when the train that OPENS it leaves in the window.
    const opener = candidates.get(ride[0].id);
    return opener ? [{ legs: ride, user: opener.user }] : [];
  });
}

export async function checkRailReminders(now: Date): Promise<void> {
  for (const hoursAhead of await activeLeadHours()) {
    const { start, end } = dueAnchorRange(hoursAhead, now);

    let rides;
    try {
      rides = await dueRides(start, end);
    } catch (error) {
      logger.error({
        operation: "reminder_scheduler_query_failed",
        domain: "rail",
        hoursAhead,
        error: { message: error instanceof Error ? error.message : "Unknown error" },
      });
      continue;
    }

    for (const { legs, user } of rides) {
      const first = legs[0];
      if (
        !leadsFor(user, "rail").includes(hoursAhead) ||
        !isDue(first.departureTime, hoursAhead, now)
      )
        continue;

      const last = legs[legs.length - 1];
      await sendDueReminder({
        user,
        domain: "rail",
        entryId: first.id,
        tripId: first.tripId,
        hours: hoursAhead,
        anchorAt: first.departureTime,
        anchorKey: first.departureTime.toISOString(),
        now,
        render: (locale) =>
          entryReminderMessage(
            "rail",
            {
              label: `${first.depStationName} → ${last.arrStationName}`,
              detail: [first.trainCategory, first.trainNumber].filter(Boolean).join(" ") || null,
              at: first.departureTime,
              zone: first.depTimezone,
            },
            hoursAhead,
            locale
          ),
        sendMail: () =>
          sendRailReminder(
            legs.map(toReminderLeg),
            {
              notificationEmail: user.notificationEmail as string,
              settingsData: user.settings?.data ?? null,
            },
            hoursAhead
          ),
      });
    }
  }
}
