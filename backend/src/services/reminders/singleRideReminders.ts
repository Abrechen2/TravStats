import { departureClockedWhere } from "../../shared/railClock";
import type { ReminderUser } from "../emailService";
import logger from "../../utils/logger";
import type { Locale, Message } from "../notifications/messages";
import { sendDueReminder } from "./dispatch";
import { dueAnchorRange, isDue } from "./due";
import { activeLeadHours, leadsFor, type PrefUser } from "./prefs";

/**
 * The shared half of the ferry and bus departure reminders: rail's windows,
 * switches and dedup, for domains whose rows carry rail's time columns (real
 * UTC instants, the terminal's zone, a departure precision) but form no ride
 * of several legs — one row is one mail. A mail goes only to a user who has
 * the domain switched on; neither domain sits behind the instance's beta
 * switch since 2026-10-26.
 */

/**
 * The window filter for a row with rail's columns: scheduled, leaving inside
 * [start, end], and with a departure that carries a clock — a date-only
 * departure is stored at the start of its day, and "leaves in 2 hours" would
 * be a time nobody printed (forgejo#132 item 17, rail's rule).
 */
export function dueWhere(start: Date, end: Date) {
  return {
    status: "scheduled",
    departureTime: { gte: start, lte: end },
    ...departureClockedWhere(),
  };
}

interface DueRow {
  id: string;
  tripId: string | null;
  departureTime: Date | null;
  user: PrefUser & { id: string };
}

export interface SingleRideReminderJob<Row extends DueRow> {
  domain: "ferry" | "bus";
  due: (start: Date, end: Date) => Promise<Row[]>;
  send: (row: Row, user: ReminderUser, hoursAhead: number) => Promise<void>;
  /** The push text for a row, in the phone's language. */
  render: (row: Row, hoursAhead: number, locale: Locale) => Message | null;
}

export async function runSingleRideReminders<Row extends DueRow>(
  job: SingleRideReminderJob<Row>,
  now: Date
): Promise<void> {
  for (const hoursAhead of await activeLeadHours()) {
    const { start, end } = dueAnchorRange(hoursAhead, now);

    let rows: Row[];
    try {
      rows = await job.due(start, end);
    } catch (error) {
      logger.error({
        operation: "reminder_scheduler_query_failed",
        domain: job.domain,
        hoursAhead,
        error: { message: error instanceof Error ? error.message : "Unknown error" },
      });
      continue;
    }

    for (const row of rows) {
      const { user, departureTime } = row;
      if (!departureTime || !leadsFor(user, job.domain).includes(hoursAhead)) continue;
      if (!isDue(departureTime, hoursAhead, now)) continue;

      await sendDueReminder({
        user,
        domain: job.domain,
        entryId: row.id,
        tripId: row.tripId,
        hours: hoursAhead,
        anchorAt: departureTime,
        anchorKey: departureTime.toISOString(),
        now,
        render: (locale) => job.render(row, hoursAhead, locale),
        sendMail: () =>
          job.send(
            row,
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
