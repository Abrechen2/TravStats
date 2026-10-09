import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { Prisma } from "../../prisma";
import { PERSON_SELECT, toPerson, type SharePerson } from "./people";

/**
 * The sharing half of the Posteingang (the fourth inbox source): consent
 * requests waiting for the caller's answer, and notices about shared trips.
 */

export interface ShareNoticeView {
  id: string;
  kind: string;
  entityType: string | null;
  entityKey: string | null;
  after: Prisma.JsonValue | null;
  createdAt: string;
  readAt: string | null;
  actor: SharePerson | null;
}

/** Up to this many notices per list answer; the inbox shows the newest. */
const NOTICE_CAP = 200;

export async function listNotices(userId: string): Promise<ShareNoticeView[]> {
  const rows = await prisma.shareNotice.findMany({
    where: { userId },
    include: { actor: { select: PERSON_SELECT } },
    orderBy: { createdAt: "desc" },
    take: NOTICE_CAP,
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    entityType: row.entityType,
    entityKey: row.entityKey,
    after: row.after,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    actor: row.actor ? toPerson(row.actor) : null,
  }));
}

export async function markNoticeRead(userId: string, noticeId: string): Promise<void> {
  const result = await prisma.shareNotice.updateMany({
    where: { id: noticeId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (result.count === 0) {
    const exists = await prisma.shareNotice.count({ where: { id: noticeId, userId } });
    if (!exists) throw new AppError("Notice not found", 404, "SHARE_NOTICE_NOT_FOUND");
  }
}

/** The inbox badge's share: open consent requests plus unread notices. */
export async function inboxCount(userId: string): Promise<number> {
  const [requests, notices] = await Promise.all([
    prisma.shareConsent.count({ where: { targetId: userId, status: "pending" } }),
    prisma.shareNotice.count({ where: { userId, readAt: null } }),
  ]);
  return requests + notices;
}
