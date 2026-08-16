import type { Prisma, PrismaClient } from "@prisma/client";
import { appVersion } from "../utils/version";
import logger from "../utils/logger";

/**
 * Record the running version as "already seen" for a brand-new account.
 *
 * The release-highlights modal shows whenever the running version has a content
 * entry the user has not dismissed. For someone who signed up five minutes ago
 * there is nothing "new" about it — they are greeted with the news of a release
 * they never ran, which reads as a bug and trains people to dismiss the modal
 * unread. Confirmed on a fresh account during the 2.6.0 UAT.
 *
 * Stamped at ACCOUNT CREATION rather than when the settings row is first read
 * lazily: an account created long ago may still have no settings row, and
 * stamping there would silence a modal it has every right to see. Creation time
 * is the only moment that reliably means "this user starts here".
 *
 * Never throws. A missing stamp costs one unnecessary modal; a failed signup
 * costs the account.
 */
export async function stampWhatsNewSeen(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  try {
    // The flag lives INSIDE the `data` JSON blob, not in a column of its own —
    // `settingsSchema` validates it, Prisma never sees it by name.
    await db.userSettings.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        data: { whatsNewSeenVersion: appVersion } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    logger.warn(
      {
        operation: "whats_new_stamp_failed",
        context: { userId },
        error: { message: error instanceof Error ? error.message : "Unknown error" },
      },
      "[WhatsNew] Could not stamp the seen version for a new account",
    );
  }
}
