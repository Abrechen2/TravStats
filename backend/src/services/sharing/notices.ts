import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { Prisma } from "../../prisma";
import {
  shareEntityTypeSchema,
  shareNoticeKindSchema,
  type ShareEntityType,
  type ShareNoticeKind,
} from "../../schemas/sharing";
import { z } from "../../schemas/zod";
import { noticeChanges, type NoticeChange } from "./noticeChanges";
import { PERSON_SELECT, toPerson, type SharePerson } from "./people";

/**
 * The sharing half of the Posteingang (the fourth inbox source): consent
 * requests waiting for the caller's answer, and notices about shared trips.
 */

export interface ShareNoticeView {
  id: string;
  kind: ShareNoticeKind;
  entityType: ShareEntityType | null;
  entityKey: string | null;
  after: Prisma.JsonValue | null;
  createdAt: string;
  readAt: string | null;
  /** When the recipient undid the change (S2) — or, on a `deleted` notice, deleted their own copy; null otherwise. */
  undoneAt: string | null;
  actor: SharePerson | null;
  /**
   * A person on another server who made the change (F-S4d), as their server names them — shown
   * as „Ben (andere.instanz.tld)". Null for a change made here.
   */
  remoteActor: RemoteActorView | null;
  /** For `updated`: every changed fact, old and new; for `conflict`: mine, then theirs. */
  changes: NoticeChange[];
}

export interface RemoteActorView {
  displayName: string;
  origin: string;
}

const remoteActorSchema = z.object({ displayName: z.string(), origin: z.string() });

/** The name a notice kept of a remote author, else the pairing it came through. */
function remoteActorOf(
  after: Prisma.JsonValue | null,
  pairing: { displayName: string; origin: string } | null
): RemoteActorView | null {
  const kept =
    after && typeof after === "object" && !Array.isArray(after)
      ? remoteActorSchema.safeParse(after.remoteActor)
      : null;
  if (kept?.success) return kept.data;
  return pairing ? { displayName: pairing.displayName, origin: pairing.origin } : null;
}

/** Up to this many notices per list answer; the inbox shows the newest. */
const NOTICE_CAP = 200;

export async function listNotices(userId: string): Promise<ShareNoticeView[]> {
  const rows = await prisma.shareNotice.findMany({
    where: { userId },
    include: {
      actor: { select: PERSON_SELECT },
      remoteActor: { select: { displayName: true, origin: true } },
    },
    orderBy: { createdAt: "desc" },
    take: NOTICE_CAP,
  });
  return rows.map((row) => ({
    id: row.id,
    // A value the database refuses cannot be read either; a parse failure is a
    // 500 with the value in the log, never a silently dropped notice.
    kind: shareNoticeKindSchema.parse(row.kind),
    entityType: row.entityType === null ? null : shareEntityTypeSchema.parse(row.entityType),
    // An entry notice's key is a share key — never sent (wireGuard.ts). A
    // `trip` notice's key is the recipient's own trip id.
    entityKey: row.entityType === "trip" ? row.entityKey : null,
    after: row.after,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    undoneAt: row.undoneAt?.toISOString() ?? null,
    actor: row.actor ? toPerson(row.actor) : null,
    remoteActor: row.actor ? null : remoteActorOf(row.after, row.remoteActor),
    changes:
      row.kind === "updated" || row.kind === "conflict" ? noticeChanges(row.before, row.after) : [],
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
