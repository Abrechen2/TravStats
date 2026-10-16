import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { Prisma } from "../../prisma";
import { z } from "zod";
import { shareEntityTypeSchema } from "../../schemas/sharing";
import { restatusTrips } from "../trip/restatusTrips";
import { ADAPTERS, type ShareEntity, type SharedRow } from "./adapters";
import { revivedRecord, sameFact } from "./factValues";
import { keyedDelegate } from "./keyOps";
import { propagateDelete, propagateWrite, shareSnapshot, SHARE_TX_TIMEOUT_MS } from "./propagate";

/**
 * Acting on a notice (design 2026-10-09, decision 3): undo a change another
 * member made, or — after a delete — delete one's own copy too.
 *
 * Both act on the caller's OWN copy only, and both are ordinary writes by the
 * caller: they propagate like any other change (owner decision 3 — changes
 * apply to everyone). An undo therefore reaches the member who made the
 * change, as an `updated` notice of its own, which they may undo in turn.
 */

const noticeNotFound = () => new AppError("Notice not found", 404, "SHARE_NOTICE_NOT_FOUND");

async function ownNotice(userId: string, noticeId: string) {
  const notice = await prisma.shareNotice.findFirst({ where: { id: noticeId, userId } });
  if (!notice) throw noticeNotFound();
  return notice;
}

function entityOf(type: string | null): ShareEntity {
  const parsed = shareEntityTypeSchema.safeParse(type);
  if (!parsed.success || parsed.data === "trip") {
    throw new AppError("This notice names no entry", 409, "SHARE_UNDO_UNAVAILABLE");
  }
  return parsed.data;
}

/** The caller's own copy behind a share key, or a 409 that says it is gone. */
async function ownCopy(
  c: DbTransaction,
  entity: ShareEntity,
  notice: { entityKey: string | null; groupId: string | null },
  userId: string
): Promise<SharedRow> {
  // Inside the notice's group only: after a leave or a withdrawal the copy is
  // the member's own independent row and no notice reaches it any more.
  const own =
    notice.entityKey && notice.groupId
      ? (await ADAPTERS[entity].copiesOf(c, notice.entityKey, notice.groupId)).find(
          (r) => r.userId === userId
        )
      : undefined;
  if (!own) {
    throw new AppError("Your copy of this entry no longer exists", 409, "SHARE_COPY_NOT_FOUND");
  }
  return own;
}

/** The `facts` object a change notice stores on each side. */
function factsOf(side: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (!side || typeof side !== "object" || Array.isArray(side)) return null;
  return (side as Prisma.JsonObject).facts ?? null;
}

export interface UndoResult {
  undone: true;
  entryId: string;
}

/**
 * Restore the values the change replaced — only when the copy still holds
 * exactly what the change wrote. If anything was changed since, the undo is
 * refused (409 `SHARE_UNDO_STALE`) and names the fields, rather than quietly
 * overwriting a later edit.
 */
export async function undoNotice(userId: string, noticeId: string): Promise<UndoResult> {
  const notice = await ownNotice(userId, noticeId);
  const movedFrom = notice.kind === "created" ? movedFromOf(notice.after) : null;
  if (movedFrom && !notice.undoneAt) return undoMoveIn(userId, notice, movedFrom);
  if (notice.kind !== "updated") {
    throw new AppError("Only a change can be undone", 409, "SHARE_UNDO_UNAVAILABLE");
  }
  if (notice.undoneAt) {
    throw new AppError("This change was already undone", 409, "SHARE_UNDO_UNAVAILABLE");
  }
  const entity = entityOf(notice.entityType);
  const after = revivedRecord(factsOf(notice.after));
  const before = revivedRecord(factsOf(notice.before));
  const keys = Object.keys(after);
  if (keys.length === 0) {
    throw new AppError("This notice carries no values", 409, "SHARE_UNDO_UNAVAILABLE");
  }

  return prisma.$transaction(
    async (tx) => {
      const own = await ownCopy(tx, entity, notice, userId);
      const changedSince = keys.filter((k) => !sameFact(own.facts[k], after[k]));
      if (changedSince.length > 0) {
        throw new AppError(
          `Changed since this notice: ${changedSince.join(", ")}`,
          409,
          "SHARE_UNDO_STALE",
          undefined,
          { fields: changedSince.join(",") }
        );
      }
      const snapshot = await shareSnapshot(tx, entity, own.id);
      await ADAPTERS[entity].apply(tx, own, before, keys);
      await tx.shareNotice.update({
        where: { id: notice.id },
        data: { undoneAt: new Date(), readAt: notice.readAt ?? new Date() },
      });
      await propagateWrite(tx, userId, entity, own.id, snapshot);
      return { undone: true as const, entryId: own.id };
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}

/** `after.movedFrom` of a `created` notice whose join moved the caller's own entry in. */
const movedFromSchema = z.object({
  movedFrom: z.object({ tripId: z.string(), tripName: z.string() }),
});

function movedFromOf(after: Prisma.JsonValue | null): { tripId: string } | null {
  const parsed = movedFromSchema.safeParse(after);
  return parsed.success ? parsed.data.movedFrom : null;
}

/**
 * Undo a join that moved the caller's own entry in from another of their trips
 * (owner decision 2026-10-16): it goes back to that trip and loses the link.
 * Moving it out is an ordinary write, so it propagates like one — its key is
 * cleared and the other members are told it left the shared trip.
 */
async function undoMoveIn(
  userId: string,
  notice: Awaited<ReturnType<typeof ownNotice>>,
  movedFrom: { tripId: string }
): Promise<UndoResult> {
  const entity = entityOf(notice.entityType);
  return prisma.$transaction(
    async (tx) => {
      const own = await ownCopy(tx, entity, notice, userId);
      const back = await tx.trip.findFirst({
        where: { id: movedFrom.tripId, userId },
        select: { id: true },
      });
      if (!back) {
        throw new AppError(
          "The trip this entry came from no longer exists",
          409,
          "SHARE_UNDO_UNAVAILABLE"
        );
      }
      const snapshot = await shareSnapshot(tx, entity, own.id);
      await keyedDelegate(tx, entity).update({ where: { id: own.id }, data: { tripId: back.id } });
      await tx.shareNotice.update({
        where: { id: notice.id },
        data: { undoneAt: new Date(), readAt: notice.readAt ?? new Date() },
      });
      await propagateWrite(tx, userId, entity, own.id, snapshot);
      await restatusTrips([own.tripId, back.id], tx);
      return { undone: true as const, entryId: own.id };
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}

/**
 * After another member deleted (or moved out) an entry: delete the caller's
 * own copy as well. The delete propagates as one — the members still holding
 * a copy are told.
 */
export async function deleteOwnCopy(userId: string, noticeId: string): Promise<{ deleted: true }> {
  const notice = await ownNotice(userId, noticeId);
  if (notice.kind !== "deleted") {
    throw new AppError("Only after a delete", 409, "SHARE_UNDO_UNAVAILABLE");
  }
  const entity = entityOf(notice.entityType);
  return prisma.$transaction(
    async (tx) => {
      const own = await ownCopy(tx, entity, notice, userId);
      const snapshot = await shareSnapshot(tx, entity, own.id);
      await ADAPTERS[entity].remove(tx, own.id);
      await tx.shareNotice.update({
        where: { id: notice.id },
        data: { readAt: notice.readAt ?? new Date() },
      });
      await propagateDelete(tx, userId, snapshot);
      return { deleted: true as const };
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
}
