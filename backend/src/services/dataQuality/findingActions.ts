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
import { mergeDuplicates } from "./duplicateMerge";
import { applyFerryLink, undoFerryLink } from "./ferryLink";
import { FindingActionError } from "./findingErrors";
import { SHARE_TX_TIMEOUT_MS } from "../sharing/propagate";
import { restatusTrips } from "../trip/restatusTrips";

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
 * | `link` (`ferry_match`) | resolved | puts the ride on the trip | yes, while it is still on that trip |
 *
 * `keep` lands on `dismissed`, not `resolved`: the runner re-opens a resolved
 * flag whose finding still holds, and "these are two entries" is exactly a
 * finding that still holds. A dismissed pair is never asked again.
 *
 * Every write names the REVISION it read in its WHERE and bumps it, so an
 * answer that races a re-run, a second click or another device changes
 * nothing and says `staleFinding`. A client that names the revision it was
 * served (`revision` in the body) is held to that one instead — the evidence
 * it showed the user is then exactly the evidence the answer applies to.
 */

/** How long an answer can be taken back. Server-side constant (owner, 2026-10-25). */
export const FINDING_UNDO_WINDOW_MS = 10 * 60 * 1000;

const asJson = (value: FindingResolution): Prisma.InputJsonValue =>
  value as unknown as Prisma.InputJsonValue;

/** What every answer may carry: the revision the client was served. */
export interface AnswerGuard {
  revision?: number;
}

async function loadFlag(id: string, userId: string, guard: AnswerGuard): Promise<DataQualityFlag> {
  const flag = await prisma.dataQualityFlag.findFirst({ where: { id, userId } });
  if (!flag) throw new FindingActionError("notFound");
  if (guard.revision !== undefined && guard.revision !== flag.revision) {
    throw new FindingActionError("staleFinding");
  }
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
  revision: flag.revision,
});

const NEXT_REVISION = { revision: { increment: 1 } } as const;

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
      ...NEXT_REVISION,
    },
  });
  if (updated.count === 0) throw new FindingActionError("staleFinding");
}

/**
 * "This is not wrong, stop asking." Never re-opened by a run. Any status may be
 * dismissed, as before — the history view takes back a `resolved` this way.
 */
export async function dismissFinding(
  id: string,
  userId: string,
  guard: AnswerGuard = {},
  now = new Date()
): Promise<void> {
  await answerStatus(await loadFlag(id, userId, guard), "dismissed", "dismiss", now);
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

/**
 * `keep`: these are separate entries. Answers every open flag over the same
 * copies, and records each sibling's NEW revision — the answer's stamp — so an
 * undo restores only a sibling nothing has touched since.
 */
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
            revision: s.revision + 1,
          })),
        }),
        ...NEXT_REVISION,
      },
    });
    if (updated.count === 0) throw new FindingActionError("staleFinding");
    for (const sibling of siblings) {
      const answered = await tx.dataQualityFlag.updateMany({
        where: { id: sibling.id, revision: sibling.revision, status: "open" },
        data: { status: "dismissed", resolvedAt: now, ...NEXT_REVISION },
      });
      if (answered.count === 0) throw new FindingActionError("staleFinding");
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
  // Validation happens INSIDE the merge's transaction, on locked rows.
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
        ...NEXT_REVISION,
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
  body: { action?: string; keptId?: string } & AnswerGuard,
  now = new Date()
): Promise<void> {
  const flag = await loadFlag(id, userId, body);
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

  // `link` — the only other action: put the ride on the trip, in the same
  // transaction as the answer.
  const linked = await prisma.$transaction(
    async (tx) => {
      const link = await applyFerryLink(tx, flag);
      const updated = await tx.dataQualityFlag.updateMany({
        where: asRead(flag),
        data: {
          status: "resolved",
          resolvedAt: now,
          undoUntil: undoUntil(now),
          resolution: asJson({ action: "link", ...previousOf(flag), link }),
          ...NEXT_REVISION,
        },
      });
      if (updated.count === 0) throw new FindingActionError("staleFinding");
      return link;
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  // A ride extends its trip's span — re-derived after commit, as the ferry
  // routes do.
  await restatusTrips([linked.tripId]);
}

/**
 * `POST /:id/undo`. Puts the last answer back while `now < undoUntil`, and
 * re-opens the finding (or restores whatever status it had before).
 */
export async function undoFinding(
  id: string,
  userId: string,
  guard: AnswerGuard = {},
  now = new Date()
): Promise<void> {
  const flag = await loadFlag(id, userId, guard);
  if (flag.status === "open") throw new FindingActionError("staleFinding");
  if (!flag.undoUntil || flag.undoUntil.getTime() <= now.getTime()) {
    throw new FindingActionError("undoExpired");
  }
  const parsed = findingResolutionSchema.safeParse(flag.resolution);
  if (!parsed.success || parsed.data.action === "merge") {
    throw new FindingActionError("undoExpired");
  }
  const resolution = parsed.data;

  await prisma.$transaction(
    async (tx) => {
      if (resolution.action === "link" && resolution.link) {
        await undoFerryLink(tx, userId, resolution.link);
      }
      const updated = await tx.dataQualityFlag.updateMany({
        where: asRead(flag),
        data: {
          status: resolution.previousStatus,
          resolvedAt: resolution.previousResolvedAt
            ? new Date(resolution.previousResolvedAt)
            : null,
          undoUntil: null,
          resolution: Prisma.DbNull,
          ...NEXT_REVISION,
        },
      });
      if (updated.count === 0) throw new FindingActionError("staleFinding");
      for (const sibling of resolution.siblings ?? []) {
        // Only a sibling still carrying this answer's stamp: one the user has
        // answered since (or a run has touched) keeps that later answer.
        if (sibling.revision === undefined) continue;
        await tx.dataQualityFlag.updateMany({
          where: { id: sibling.id, userId, revision: sibling.revision },
          data: {
            status: sibling.status,
            resolvedAt: sibling.resolvedAt ? new Date(sibling.resolvedAt) : null,
            ...NEXT_REVISION,
          },
        });
      }
    },
    // A link's undo propagates like the link: same sharing timeout.
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  if (resolution.action === "link" && resolution.link) {
    await restatusTrips([resolution.link.tripId]);
  }
}
