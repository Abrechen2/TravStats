import { departureClockedWhere } from "../../shared/railClock";
import type { ReminderUser } from "../emailService";
import logger from "../../utils/logger";
import { reminderDomainEnabled } from "./domainEnabled";

/**
 * The shared half of the ferry and bus departure reminders: rail's windows,
 * switches and dedup, for domains whose rows carry rail's time columns (real
 * UTC instants, the terminal's zone, a departure precision) but form no ride
 * of several legs — one row is one mail. A mail goes only to a user who has
 * the domain switched on; neither domain sits behind the instance's beta
 * switch since 2026-10-26.
 */

export const REMINDER_WINDOWS = [
  { hoursAhead: 24, key: "24h" },
  { hoursAhead: 2, key: "2h" },
] as const;

/** The user columns every reminder query selects. */
export const REMINDER_USER_SELECT = {
  select: {
    notificationEmail: true,
    notifyBefore24h: true,
    notifyBefore2h: true,
    settings: { select: { data: true, enabledDomains: true } },
  },
} as const;

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
  user: {
    notificationEmail: string | null;
    notifyBefore24h: boolean;
    notifyBefore2h: boolean;
    settings: { data: unknown; enabledDomains: string[] } | null;
  };
}

export interface SingleRideReminderJob<Row extends DueRow> {
  domain: "ferry" | "bus";
  /** Remembers `<domain>:<id>-<window>` so no row is announced twice per window. */
  sent: Set<string>;
  due: (start: Date, end: Date) => Promise<Row[]>;
  send: (row: Row, user: ReminderUser, hoursAhead: number) => Promise<void>;
}

export async function runSingleRideReminders<Row extends DueRow>(
  job: SingleRideReminderJob<Row>,
  now: Date
): Promise<void> {
  for (const { hoursAhead, key } of REMINDER_WINDOWS) {
    const target = now.getTime() + hoursAhead * 60 * 60 * 1000;

    let rows: Row[];
    try {
      rows = await job.due(new Date(target - 15 * 60 * 1000), new Date(target + 15 * 60 * 1000));
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
      const reminderKey = `${job.domain}:${row.id}-${key}`;
      if (job.sent.has(reminderKey)) continue;

      const { user } = row;
      const shouldSend =
        user.notificationEmail !== null &&
        reminderDomainEnabled(user.settings, job.domain) &&
        ((key === "24h" && user.notifyBefore24h) || (key === "2h" && user.notifyBefore2h));
      if (!shouldSend) continue;

      try {
        await job.send(
          row,
          { notificationEmail: user.notificationEmail, settingsData: user.settings?.data ?? null },
          hoursAhead
        );
        job.sent.add(reminderKey);
      } catch (error) {
        logger.error({
          operation: "reminder_scheduler_send_failed",
          domain: job.domain,
          journeyId: row.id,
          hoursAhead,
          error: { message: error instanceof Error ? error.message : "Unknown error" },
        });
      }
    }
  }
}
