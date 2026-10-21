/**
 * Changed at the same time on two servers (spec 2026-10-20 F6, phase F-S4d). Locally one database
 * orders the writes and the last one wins; two servers can each apply their own edit and then
 * receive the other's, and would end swapped. So a change from another server is written only
 * where the copy still holds the value the sender held before; where it does not, NOTHING is
 * written on either side and both people get a `conflict` notice showing their value and the
 * other one.
 *
 * Either answer is an ordinary write that propagates with a fresh `before`:
 * - **theirs** — the other value is written onto the caller's copy; the other side already holds
 *   it, finds its copy equal to the change and closes its own conflict notice;
 * - **mine** — the caller's value is sent again with the other value as its `before`, which the
 *   other side still holds, so it applies there.
 * The group converges after one human decision. An answer against a copy that moved since the
 * notice is refused (`SHARE_REMOTE_CONFLICT_STALE`), naming the facts.
 */
import { prisma, type DbTransaction } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import type { Prisma } from "../../../prisma";
import { shareEntityTypeSchema } from "../../../schemas/sharing";
import { ADAPTERS, type ShareEntity, type SharedRow } from "../adapters";
import { jsonSubset, revivedRecord, sameFact, type FactRecord } from "../factValues";
import type { MemberTrip } from "../members";
import {
  noticeMeta,
  recordEntryNotice,
  shareSnapshot,
  propagateWrite,
  spreadUpdate,
  SHARE_TX_TIMEOUT_MS,
} from "../propagate";
import type { ChangeAuthor } from "./outbound";
import { remoteShareError } from "./errors";

const asObject = (v: Prisma.JsonValue | null): Prisma.JsonObject =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};

/** The facts of the open conflict notices `userId` holds for one entry. */
async function openConflictKeys(
  c: DbTransaction,
  userId: string,
  groupId: string,
  shareKey: string
) {
  const rows = await c.shareNotice.findMany({
    where: { userId, groupId, entityKey: shareKey, kind: "conflict", undoneAt: null },
    select: { id: true, after: true },
  });
  return rows.map((r) => ({
    id: r.id,
    keys: Object.keys(asObject(asObject(r.after).facts ?? null)),
  }));
}

export interface ConflictInput {
  recipient: MemberTrip;
  groupId: string;
  author: ChangeAuthor;
  entity: ShareEntity;
  copy: SharedRow;
  /** The other side's values, as this server's facts, for the facts in conflict. */
  theirs: FactRecord;
  keys: readonly string[];
}

/**
 * A `conflict` notice for the person whose copy holds `copy`. Each side writes one whatever way
 * the conflict reached it (as receiver, or through the acknowledgement as sender); a second for
 * facts an open notice already shows is not written.
 */
export async function recordConflict(c: DbTransaction, input: ConflictInput): Promise<void> {
  const key = input.copy.shareKey as string;
  const open = await openConflictKeys(c, input.recipient.userId, input.groupId, key);
  const shown = new Set(open.flatMap((o) => o.keys));
  if (input.keys.every((k) => shown.has(k))) return;
  await recordEntryNotice(c, {
    recipient: input.recipient,
    groupId: input.groupId,
    author: input.author,
    kind: "conflict",
    entity: input.entity,
    shareKey: key,
    before: { facts: jsonSubset(input.copy.facts, input.keys), zones: input.copy.zones },
    after: {
      ...noticeMeta(input.copy, input.recipient, input.copy.id),
      facts: jsonSubset(input.theirs, input.keys),
    },
  });
}

/**
 * A change arrived that the copy already holds: the conflict its notices showed is settled, so
 * those notices close (the other side chose the same value, or "theirs").
 */
export async function settleConflicts(
  c: DbTransaction,
  userId: string,
  groupId: string,
  shareKey: string,
  keys: readonly string[]
): Promise<void> {
  if (keys.length === 0) return;
  const open = await openConflictKeys(c, userId, groupId, shareKey);
  const settled = open.filter((o) => o.keys.length > 0 && o.keys.every((k) => keys.includes(k)));
  if (settled.length === 0) return;
  const now = new Date();
  await c.shareNotice.updateMany({
    where: { id: { in: settled.map((o) => o.id) } },
    data: { undoneAt: now, readAt: now },
  });
}

const unavailable = () =>
  new AppError("This conflict was already answered", 409, "SHARE_UNDO_UNAVAILABLE");

/** Answer a conflict notice: take the other value (`theirs`) or keep one's own (`mine`). */
export async function resolveConflict(
  userId: string,
  noticeId: string,
  choice: "mine" | "theirs"
): Promise<{ resolved: true; entryId: string }> {
  const notice = await prisma.shareNotice.findFirst({ where: { id: noticeId, userId } });
  if (!notice) throw new AppError("Notice not found", 404, "SHARE_NOTICE_NOT_FOUND");
  if (notice.kind !== "conflict" || notice.undoneAt) throw unavailable();
  const type = shareEntityTypeSchema.safeParse(notice.entityType);
  if (!type.success || type.data === "trip" || !notice.groupId || !notice.entityKey)
    throw unavailable();
  const entity = type.data;
  const { groupId, entityKey } = notice;
  const mine = revivedRecord(asObject(notice.before).facts ?? null);
  const theirs = revivedRecord(asObject(notice.after).facts ?? null);
  const keys = Object.keys(theirs);
  if (keys.length === 0) throw unavailable();

  return prisma.$transaction(
    async (tx) => {
      const adapter = ADAPTERS[entity];
      const own = (await adapter.copiesOf(tx, entityKey, groupId)).find((r) => r.userId === userId);
      if (!own)
        throw new AppError("Your copy of this entry no longer exists", 409, "SHARE_COPY_NOT_FOUND");
      const close = () =>
        tx.shareNotice.update({
          where: { id: notice.id },
          data: { undoneAt: new Date(), readAt: notice.readAt ?? new Date() },
        });
      // Already holding their value (their own answer arrived first): only close.
      if (choice === "theirs" && keys.every((k) => sameFact(own.facts[k], theirs[k]))) {
        await close();
        return { resolved: true as const, entryId: own.id };
      }
      const moved = keys.filter((k) => !sameFact(own.facts[k], mine[k]));
      if (moved.length > 0)
        throw remoteShareError(
          "SHARE_REMOTE_CONFLICT_STALE",
          409,
          `Changed since this conflict: ${moved.join(", ")}`,
          { userId },
          { fields: moved.join(",") }
        );
      if (choice === "theirs") {
        const snapshot = await shareSnapshot(tx, entity, own.id);
        await adapter.apply(tx, own, theirs, keys, mine);
        await close();
        await propagateWrite(tx, userId, entity, own.id, snapshot);
      } else {
        // Nothing changes here; the own value goes out again with the other one as `before`.
        await close();
        await spreadUpdate(
          tx,
          adapter,
          { groupId, author: { kind: "user", id: userId }, via: [userId], fromOrigin: null },
          own,
          { ...own.facts, ...theirs }
        );
      }
      return { resolved: true as const, entryId: own.id };
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}
