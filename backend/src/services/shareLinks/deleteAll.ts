import { prisma } from "../../db";
import logger from "../../utils/logger";

/**
 * Every public share link on the instance, gone — when the instance switch
 * goes off and after a backup restore (forgejo#281, design §2 T7/T14). Its own
 * module so the settings service and the restore path need nothing else of
 * the share-link code.
 */
export async function deleteAllShareLinks(reason: string): Promise<number> {
  const { count } = await prisma.publicShareLink.deleteMany({});
  if (count > 0) logger.warn({ operation: "share_links_deleted_all", count, reason });
  return count;
}
