import type { ReminderUser } from "../emailService";
import logger from "../../utils/logger";
import type { Locale, Message } from "../notifications/messages";
import { sendDueReminder } from "./dispatch";
import { dueAnchorRange, isDue } from "./due";
import { activeLeadHours, leadsFor, type PrefUser, type ReminderDomain } from "./prefs";

/**
 * The shared half of the rental, roadtrip-station and place-visit reminders
 * (forgejo#405): rows whose anchor instant is computed from the row (not a
 * plain departure column), possibly more than one per row. The windows, the
 * lead switches and the dedup are the single-ride runner's; only the anchors
 * differ. A user gets a reminder only for a domain switched on in the
 * account (`leadsFor`), exactly as every other area.
 */
export interface Anchor {
  /** Names which of a row's anchors this is (rental: `pickup` | `return`). */
  part?: string;
  at: Date;
  /** The stored values the anchor came from, see `stillEligible`. */
  key: string;
}

interface AnchorRow {
  id: string;
  user: PrefUser & { id: string };
}

export interface AnchorReminderJob<Row extends AnchorRow> {
  domain: ReminderDomain;
  /** Rows that MAY have an anchor inside [start, end]; the exact test is `isDue`. */
  due: (start: Date, end: Date) => Promise<Row[]>;
  anchorsOf: (row: Row) => Anchor[];
  tripId: (row: Row) => string | null;
  /** Ids the push carries beside `entryId` (lodging's `lodgingId`, here `rentalId` …). */
  ids: (row: Row) => Record<string, string>;
  render: (row: Row, anchor: Anchor, hoursAhead: number, locale: Locale) => Message | null;
  send: (row: Row, anchor: Anchor, user: ReminderUser, hoursAhead: number) => Promise<void>;
}

export async function runAnchorReminders<Row extends AnchorRow>(
  job: AnchorReminderJob<Row>,
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
      const { user } = row;
      if (!leadsFor(user, job.domain).includes(hoursAhead)) continue;
      // One bad row must not stop the batch: anchors are computed from stored values.
      try {
        for (const anchor of job.anchorsOf(row)) {
          if (!isDue(anchor.at, hoursAhead, now)) continue;
          await sendDueReminder({
            user,
            domain: job.domain,
            entryId: row.id,
            extraIds: job.ids(row),
            ...(anchor.part !== undefined && { part: anchor.part }),
            tripId: job.tripId(row),
            hours: hoursAhead,
            anchorAt: anchor.at,
            anchorKey: anchor.key,
            now,
            render: (locale) => job.render(row, anchor, hoursAhead, locale),
            sendMail: () =>
              job.send(
                row,
                anchor,
                {
                  notificationEmail: user.notificationEmail as string,
                  settingsData: user.settings?.data ?? null,
                },
                hoursAhead
              ),
          });
        }
      } catch (error) {
        logger.error({
          operation: "reminder_scheduler_send_failed",
          domain: job.domain,
          entryId: row.id,
          error: { message: error instanceof Error ? error.message : "Unknown error" },
        });
      }
    }
  }
}
