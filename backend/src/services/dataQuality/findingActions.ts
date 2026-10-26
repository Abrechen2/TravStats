import { Prisma, type DataQualityFlag } from "../../prisma";

import { prisma } from "../../db";
import {
  FINDING_ACTIONS,
  findingResolutionSchema,
  type FindingAction,
  type FindingResolution,
} from "../../schemas/dataQualityFindings";
import { duplicateCandidateDetailsSchema } from "../../schemas/dataQualityRecordChecks";
import { duplicateEvidence, findingActionsOf } from "./findingEvidence";
import { mergeDuplicates, assertStillDuplicates } from "./duplicateMerge";
import { FindingActionError } from "./findingErrors";

export { FindingActionError };

/**
 * Answering an inbox finding, and taking an answer back (spec 2026-10-25 C3).
 *
 * | Answer | Status after | Changes data | Undo |
 * |---|---|---|---|
 * | `resolve` (no action) | resolved | no | yes |
 * | `dismiss` | dismissed | no | yes |
 * | `keep` (duplicate) | dismissed, with the other flags of the same copies | no | yes |
 * | `merge` (duplicate) | resolved | moves attachments, deletes the other copies | **no** — the app delays the call |
 * | `link` (ferry match) | resolved | puts the ride on the trip | yes, while it is still on that trip |
 *
 * `keep` lands on `dismissed`, not `resolved`: the runner re-opens a resolved
 * flag whose finding still holds, and "these are two entries" is exactly a
 * finding that still holds. A dismissed pair is never asked again.
 *
 * Every write names the status it read in its WHERE, so an answer that races
 * a re-run or a second click changes nothing and says `staleFinding`.
 */

/** How long an answer can be taken back. Server-side constant (owner, 2026-10-25). */
export const FINDING_UNDO_WINDOW_MS = 10 * 60 * 1000;

const asJson = (value: FindingResolution): Prisma.InputJsonValue =>
  value as unknown as Prisma.InputJsonValue;

async function loadFlag(id: string, userId: string): Promise<DataQualityFlag> {
  const flag = await prisma.dataQualityFlag.findFirst({ where: { id, userId } });
  if (!flag) throw new FindingActionError("notFound");
  return flag;
}

const previousOf = (flag: DataQualityFlag) => ({
  previousStatus: flag.status as FindingResolution["previousStatus"],
  previousResolvedAt: flag.resolvedAt ? flag.resolvedAt.toISOString() : null,
});

const undoUntil = (now: Date) => new Date(now.getTime() + FINDING_UNDO_WINDOW_MS);

/** The flag exactly as it was read — the guard every write puts in its WHERE. */
const asRead = (flag: DataQualityFlag) => ({
  id: flag.id,
  userId: flag.userId,
  status: flag.status,
});

/** A status-only answer: the old `resolve`/`dismiss`, now with an undo window. */
async function answerStatus(
  flag: DataQualityFlag,
  status: "resolved" | "dismissed",
  action: "resolve" | "dismiss",
  now: Date
): Promise<void> {
  const updated = await prisma.dataQualityFlag.updateMany({
    where: asRead(flag),
    data: {
      status,
      resolvedAt: now,
      undoUntil: undoUntil(now),
      resolution: asJson({ action, ...previousOf(flag) }),
    },
  });
  if (updated.count === 0) throw new FindingActionError("staleFinding");
}

/**
 * "This is not wrong, stop asking." Never re-opened by a run. Any status may be
 * dismissed, as before — the history view takes back a `resolved` this way.
 */
export async function dismissFinding(id: string, userId: string, now = new Date()): Promise<void> {
  await answerStatus(await loadFlag(id, userId), "dismissed", "dismiss", now);
}

function parseAction(raw: string | undefined): FindingAction | undefined {
  if (raw === undefined) return undefined;
  if (!(FINDING_ACTIONS as readonly string[]).includes(raw)) {
    throw new FindingActionError("invalidAction", "unknownAction");
  }
  return raw as FindingAction;
}

function duplicateOf(flag: DataQualityFlag) {
  const details = duplicateCandidateDetailsSchema.safeParse(flag.details);
  if (!details.success) throw new FindingActionError("staleFinding");
  return duplicateEvidence(flag.entityType as never, flag.entityId, details.data);
}

/** `keep`: these are separate entries. Answers every open flag over the same copies. */
async function keep(flag: DataQualityFlag, now: Date): Promise<void> {
  const { ids, entityType } = duplicateOf(flag);
  await prisma.$transaction(async (tx) => {
    const siblings = await tx.dataQualityFlag.findMany({
      where: {
        userId: flag.userId,
        kind: "duplicate_candidate",
        entityType,
        entityId: { in: ids },
        status: "open",
        id: { not: flag.id },
      },
    });
    const updated = await tx.dataQualityFlag.updateMany({
      where: asRead(flag),
      data: {
        status: "dismissed",
        resolvedAt: now,
        undoUntil: undoUntil(now),
        resolution: asJson({
          action: "keep",
          ...previousOf(flag),
          siblings: siblings.map((s) => ({
            id: s.id,
            status: s.status as FindingResolution["previousStatus"],
            resolvedAt: s.resolvedAt ? s.resolvedAt.toISOString() : null,
          })),
        }),
      },
    });
    if (updated.count === 0) throw new FindingActionError("staleFinding");
    if (siblings.length > 0) {
      await tx.dataQualityFlag.updateMany({
        where: { id: { in: siblings.map((s) => s.id) }, status: "open" },
        data: { status: "dismissed", resolvedAt: now },
      });
    }
  });
}

/** `merge`: keep one copy, move what hangs off the others onto it, delete them. */
async function merge(flag: DataQualityFlag, keptIdOverride: string | undefined, now: Date) {
  const evidence = duplicateOf(flag);
  const keptId = keptIdOverride ?? evidence.keptId;
  if (!evidence.ids.includes(keptId)) {
    throw new FindingActionError("invalidAction", "keptIdNotInFinding");
  }
  const removedIds = evidence.ids.filter((id) => id !== keptId);
  await assertStillDuplicates(flag.userId, evidence.entityType, evidence.ids);
  await mergeDuplicates(flag.userId, evidence.entityType, keptId, removedIds, async (tx) => {
    // The other questions about these copies are answered by the merge: the
    // copies they name are gone. This flag moves onto the kept record, so the
    // history still has a subject to show.
    await tx.dataQualityFlag.deleteMany({
      where: {
        userId: flag.userId,
        entityType: evidence.entityType,
        id: { not: flag.id },
        OR: [{ entityId: { in: removedIds } }, { entityId: keptId, kind: flag.kind }],
      },
    });
    const updated = await tx.dataQualityFlag.updateMany({
      where: asRead(flag),
      data: {
        entityId: keptId,
        status: "resolved",
        resolvedAt: now,
        undoUntil: null,
        resolution: asJson({
          action: "merge",
          ...previousOf(flag),
          merged: { keptId, removedIds },
        }),
      },
    });
    if (updated.count === 0) throw new FindingActionError("staleFinding");
  });
}

/**
 * `POST /:id/resolve`. No action is the old answer, "I have corrected the
 * data", and keeps its old reach (any status). An action needs an open flag
 * that offers it.
 */
export async function resolveFinding(
  id: string,
  userId: string,
  body: { action?: string; keptId?: string },
  now = new Date()
): Promise<void> {
  const flag = await loadFlag(id, userId);
  const action = parseAction(body.action);
  if (!action) {
    await answerStatus(flag, "resolved", "resolve", now);
    return;
  }
  if (!findingActionsOf(flag.kind, flag.entityType).includes(action)) {
    throw new FindingActionError("invalidAction", "notOffered");
  }
  if (flag.status !== "open") throw new FindingActionError("staleFinding");

  if (action === "keep") return keep(flag, now);
  if (action === "merge") return merge(flag, body.keptId, now);

  // No kind offers any other action yet.
  throw new FindingActionError("invalidAction", "notOffered");
}

/**
 * `POST /:id/undo`. Puts the last answer back while `now < undoUntil`, and
 * re-opens the finding (or restores whatever status it had before).
 */
export async function undoFinding(id: string, userId: string, now = new Date()): Promise<void> {
  const flag = await loadFlag(id, userId);
  if (flag.status === "open") throw new FindingActionError("staleFinding");
  if (!flag.undoUntil || flag.undoUntil.getTime() <= now.getTime()) {
    throw new FindingActionError("undoExpired");
  }
  const parsed = findingResolutionSchema.safeParse(flag.resolution);
  if (!parsed.success || parsed.data.action === "merge") {
    throw new FindingActionError("undoExpired");
  }
  const resolution = parsed.data;

  await prisma.$transaction(async (tx) => {
    const updated = await tx.dataQualityFlag.updateMany({
      where: { ...asRead(flag), undoUntil: flag.undoUntil },
      data: {
        status: resolution.previousStatus,
        resolvedAt: resolution.previousResolvedAt ? new Date(resolution.previousResolvedAt) : null,
        undoUntil: null,
        resolution: Prisma.DbNull,
      },
    });
    if (updated.count === 0) throw new FindingActionError("staleFinding");
    for (const sibling of resolution.siblings ?? []) {
      // Only a sibling this answer dismissed, and nothing has touched since.
      await tx.dataQualityFlag.updateMany({
        where: { id: sibling.id, userId, status: "dismissed" },
        data: {
          status: sibling.status,
          resolvedAt: sibling.resolvedAt ? new Date(sibling.resolvedAt) : null,
        },
      });
    }
  });
}
