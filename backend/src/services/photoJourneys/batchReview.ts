import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { TimeFieldInput } from "../../shared/time/timeInput";
import logger from "../../utils/logger";
import { attachJourneyPhotosToVisit, type AttachOutcome } from "../places/visitPhotoLinks";
import { acceptVisitFinding, type AcceptVisitOutcome } from "./acceptVisit";

/**
 * Answering several photo findings at once (forgejo#211, O5): accept, correct
 * and accept, or reject — and say, per finding, what happened.
 *
 * N single PATCHes from the browser would answer the batch with N promises
 * and an ambiguous middle: three of five went through, the fourth timed out,
 * and nobody can say whether it landed. Here every item is answered on its
 * own (each accept is its own transaction, as the single route's is), so one
 * failure never undoes or blocks the others, and the result names each
 * item's outcome with a stable code the web turns into its own words.
 *
 * Only `visit` findings are ACCEPTED here: they are the one kind the server
 * creates for (`acceptVisit.ts`). The other kinds are accepted by the client
 * creating the entry first, which is a per-card act. Rejecting works for every
 * kind — and only for a PENDING row: a rejected finding is remembered by its
 * fingerprint and never asked again, and an accepted one has already made
 * something that a rejection would orphan.
 */

export interface BatchReviewItem {
  id: string;
  action: "accept" | "dismiss";
  name?: string;
  localName?: string;
  placeId?: string;
  visitedAt?: TimeFieldInput;
}

/** Why one item failed — stable, for the web to put into words. */
export type BatchFailureCode =
  | "NOT_FOUND"
  | "ALREADY_ANSWERED"
  | "NOT_A_VISIT"
  | "VISIT_NAME_REQUIRED"
  | "VISIT_PLACE_NOT_FOUND"
  | "TIME_INVALID"
  | "INTERNAL";

export type BatchReviewResult =
  | {
      id: string;
      action: "accept";
      outcome: "accepted";
      created: AcceptVisitOutcome;
      photos: AttachOutcome | null;
    }
  | { id: string; action: "dismiss"; outcome: "dismissed" }
  | {
      id: string;
      action: BatchReviewItem["action"];
      outcome: "failed";
      code: BatchFailureCode;
    };

const TIME_CODES = new Set([
  "TIME_SHAPE_REQUIRED",
  "LOCAL_TIME_NONEXISTENT",
  "TZ_UNRESOLVED",
  "ZONE_UNKNOWN",
]);

function codeOf(error: unknown): BatchFailureCode {
  if (error instanceof AppError) {
    if (error.code === "VISIT_NAME_REQUIRED" || error.code === "VISIT_PLACE_NOT_FOUND") {
      return error.code;
    }
    if (error.code && TIME_CODES.has(error.code)) return "TIME_INVALID";
    if (error.statusCode === 404) return "NOT_FOUND";
  }
  return "INTERNAL";
}

async function answerOne(userId: string, item: BatchReviewItem): Promise<BatchReviewResult> {
  const row = await prisma.photoJourney.findFirst({
    where: { id: item.id, userId },
    select: { kind: true, status: true },
  });
  const fail = (code: BatchFailureCode): BatchReviewResult => ({
    id: item.id,
    action: item.action,
    outcome: "failed",
    code,
  });
  if (!row) return fail("NOT_FOUND");

  if (item.action === "dismiss") {
    if (row.status === "dismissed") return { id: item.id, action: "dismiss", outcome: "dismissed" };
    if (row.status !== "pending") return fail("ALREADY_ANSWERED");
    // Guarded on `pending` in the WHERE, so a row answered between the read
    // and this write is not flipped.
    const { count } = await prisma.photoJourney.updateMany({
      where: { id: item.id, userId, status: "pending" },
      data: { status: "dismissed", resolvedAt: new Date() },
    });
    return count === 1
      ? { id: item.id, action: "dismiss", outcome: "dismissed" }
      : fail("ALREADY_ANSWERED");
  }

  if (row.kind !== "visit") return fail("NOT_A_VISIT");
  if (row.status === "dismissed") return fail("ALREADY_ANSWERED");
  const created = await acceptVisitFinding(userId, item.id, item);
  // Reported, never thrown — as the single route: the answer is recorded.
  const photos = await attachJourneyPhotosToVisit(userId, item.id, created.placeVisitId);
  return { id: item.id, action: "accept", outcome: "accepted", created, photos };
}

export async function reviewPhotoFindings(
  userId: string,
  items: readonly BatchReviewItem[]
): Promise<BatchReviewResult[]> {
  const results: BatchReviewResult[] = [];
  // One after another: each accept is a transaction plus an Immich search for
  // the photographs, and a batch is capped well below what that makes slow.
  for (const item of items) {
    try {
      results.push(await answerOne(userId, item));
    } catch (error) {
      const code = codeOf(error);
      if (code === "INTERNAL") {
        logger.error({
          operation: "photo_journey_batch_item_failed",
          userId,
          journeyId: item.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      results.push({ id: item.id, action: item.action, outcome: "failed", code });
    }
  }
  return results;
}
