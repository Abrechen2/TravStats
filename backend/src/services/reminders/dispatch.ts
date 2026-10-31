import logger from "../../utils/logger";
import { notifyEntryReminder } from "../notifications/dispatcher";
import type { Locale, Message } from "../notifications/messages";
import { claimReminder, markSent, releaseClaim } from "./claims";
import { stillEligible } from "./eligibility";
import { wantsApp, wantsMail, type PrefUser, type ReminderDomain } from "./prefs";

/**
 * One due reminder, sent on each channel the account chose. The channels are
 * independent: a failing mail never skips the push, and the push never waits
 * for the mail. Mail dedupes per account through the same durable claim table
 * as push does per device; each channel re-checks the entry and the settings
 * right before it sends.
 */
export interface DueReminder {
  user: PrefUser & { id: string };
  domain: ReminderDomain;
  entryId: string;
  /** Lodging only: the stay's lodging id, carried into the push data (companion request). */
  lodgingId?: string;
  tripId: string | null;
  hours: number;
  /** The entry's real instant (claims re-arm when it moves by more than 30 min). */
  anchorAt: Date;
  /** The entry's stored time as the finder read it, see `stillEligible`. */
  anchorKey: string;
  /** Builds and sends the mail; throws on failure. Called only when the mail is due. */
  sendMail: () => Promise<void>;
  render: (locale: Locale) => Message | null;
  now: Date;
}

export async function sendDueReminder(due: DueReminder): Promise<void> {
  const { user, domain, entryId, hours } = due;

  if (wantsApp(user, domain, hours)) {
    try {
      await notifyEntryReminder(user.id, {
        domain,
        entryId,
        ...(due.lodgingId !== undefined && { lodgingId: due.lodgingId }),
        tripId: due.tripId,
        hours,
        anchorAt: due.anchorAt,
        anchorKey: due.anchorKey,
        render: due.render,
      });
    } catch (error) {
      logger.warn({
        operation: "reminder_push_failed",
        domain,
        entryId,
        hours,
        error: { message: error instanceof Error ? error.message : "Unknown error" },
      });
    }
  }

  if (!wantsMail(user, domain, hours)) return;
  let claim: Awaited<ReturnType<typeof claimReminder>> = null;
  try {
    claim = await claimReminder(
      { userId: user.id, domain, entryId, leadHours: hours, channel: "mail" },
      due.anchorAt,
      due.now
    );
    if (!claim) return;
    const eligible = await stillEligible({
      userId: user.id,
      domain,
      entryId,
      hours,
      channel: "mail",
      anchorKey: due.anchorKey,
    });
    if (!eligible) {
      await releaseClaim(claim);
      return;
    }
    await due.sendMail();
    await markSent(claim);
  } catch (error) {
    if (claim) await releaseClaim(claim).catch(() => undefined);
    logger.error({
      operation: "reminder_scheduler_send_failed",
      domain,
      entryId,
      hoursAhead: hours,
      error: { message: error instanceof Error ? error.message : "Unknown error" },
    });
  }
}
