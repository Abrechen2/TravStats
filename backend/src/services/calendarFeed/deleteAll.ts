import { prisma } from "../../db";
import logger from "../../utils/logger";

/**
 * Every calendar subscription URL on the instance, gone — after a backup
 * restore (forgejo#310), for the reason share links go then: a dump taken
 * before a revoke would bring the revoked URL back to life. A user issues a
 * new URL from the settings page. Its own module so the restore path needs
 * nothing else of the feed code.
 */
export async function deleteAllCalendarFeeds(reason: string): Promise<number> {
  const { count } = await prisma.calendarFeed.deleteMany({});
  if (count > 0) logger.warn({ operation: "calendar_feeds_deleted_all", count, reason });
  return count;
}
