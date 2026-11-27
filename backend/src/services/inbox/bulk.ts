/**
 * Bulk answers in the inbox (owner 2026-11-26): everything of one trip, one period or one source
 * answered at once. Each item goes through its kind's OWN accept/reject service — the same calls
 * the per-item routes make — and is answered on its own: one refusal never stops the rest, and
 * the caller gets done / skipped / failed per item with a reason.
 *
 * "Accept" takes only what needs no further input: a flight update as proposed, a stay finding
 * that already names its place. Everything else (a new trip's name, a country verdict, a photo's
 * trip, a data-quality question) is `skipped: needsInput` and stays in the inbox. Plugin archive
 * proposals are not inbox items here at all: a write to an external archive is confirmed per item.
 */
import { z } from "zod";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { toLocal } from "../../shared/time/instant";
import { dismissFinding, FindingActionError } from "../dataQuality";
import { acceptStay, rejectStay } from "../dawarich/stays/review";
import { requireStaySuggestionsEnabled } from "../dawarich/stays/availability";
import { stayReviewSchema } from "../../schemas/dawarichStays";
import { closeJourneyRuns } from "../locationEvidence/journeys/accept";
import { loadSuggestion, rejectSuggestion } from "../locationEvidence/suggestionStore";
import {
  applyPendingUpdate,
  getPendingUpdateById,
  rejectPendingUpdate,
} from "../pendingUpdateService";
import { reviewPhotoFindings } from "../photoJourneys/batchReview";
import { tripSuggestionsEnabled } from "../settings/suggestionSwitches";
import { dismissSuggestion, staleError } from "../tripSuggestions/accept";
import { computeTripSuggestions } from "../tripSuggestions/engine";
import { recordTravTrackTripDecision } from "../tripSuggestions/travTrackDecision";

export const BULK_KINDS = ["review", "trips", "updates", "photos", "dawarich", "location"] as const;
export type BulkKind = (typeof BULK_KINDS)[number];
/** Most items one request answers; the page sends a group or a filtered set. */
export const BULK_MAX = 200;

export const bulkBodySchema = z
  .object({
    action: z.enum(["accept", "reject"]),
    items: z
      .array(z.object({ kind: z.enum(BULK_KINDS), id: z.string().min(1).max(200) }).strict())
      .min(1)
      .max(BULK_MAX),
  })
  .strict();
export type BulkBody = z.infer<typeof bulkBodySchema>;

export type BulkResult = {
  kind: BulkKind;
  id: string;
  outcome: "done" | "skipped" | "failed";
  /** skipped: `needsInput`; failed: the service's code (`SUGGESTION_NOT_FOUND`, …). */
  reason?: string;
  /** The kind can take this answer back (data-quality: `POST /data-quality-flags/:id/undo`). */
  undoable?: true;
};

const reasonOf = (e: unknown): string =>
  e instanceof FindingActionError
    ? e.code
    : e instanceof AppError
      ? (e.code ?? e.message)
      : "failed";

/** The engine's trip proposals, computed once per request (it is the expensive part). */
async function tripProposals(userId: string) {
  if (!(await tripSuggestionsEnabled(userId)))
    throw new AppError("Trip suggestions are switched off", 409, "TRIP_SUGGESTIONS_DISABLED");
  return (await computeTripSuggestions(userId)).suggestions;
}

/** A stay finding that already names its place and a name is accepted as it stands. */
async function acceptStayAsIs(
  userId: string,
  id: string
): Promise<BulkResult["outcome"] | "needsInput"> {
  const row = await prisma.dawarichStay.findFirst({
    where: { id, userId },
    select: {
      name: true,
      placeId: true,
      tripId: true,
      lat: true,
      lon: true,
      startAt: true,
      endAt: true,
      zone: true,
    },
  });
  if (!row) throw new AppError("Suggestion not found", 404, "SUGGESTION_NOT_FOUND");
  if (!row.name || !row.placeId) return "needsInput";
  await requireStaySuggestionsEnabled(userId);
  // Parsed like the per-item route's body, so the times read exactly as a typed answer would.
  await acceptStay(
    userId,
    id,
    stayReviewSchema.parse({
      name: row.name,
      placeId: row.placeId,
      tripId: row.tripId,
      lat: row.lat,
      lon: row.lon,
      startAt: { local: toLocal(row.startAt, row.zone).local.slice(0, 16) },
      endAt: { local: toLocal(row.endAt, row.zone).local.slice(0, 16) },
    })
  );
  return "done";
}

async function acceptOne(userId: string, kind: BulkKind, id: string): Promise<BulkResult> {
  switch (kind) {
    case "updates": {
      if (!(await getPendingUpdateById(id, userId)))
        return { kind, id, outcome: "failed", reason: "NOT_FOUND" };
      const flight = await applyPendingUpdate(id, userId);
      if (!flight) return { kind, id, outcome: "failed", reason: "NOT_APPLIED" };
      return { kind, id, outcome: "done" };
    }
    case "dawarich": {
      const outcome = await acceptStayAsIs(userId, id);
      return outcome === "needsInput"
        ? { kind, id, outcome: "skipped", reason: "needsInput" }
        : { kind, id, outcome };
    }
    default:
      // A trip's name and dates, a country verdict, a journey's mode, a photo's trip, a data
      // question's answer: the person has to give them.
      return { kind, id, outcome: "skipped", reason: "needsInput" };
  }
}

async function rejectOne(
  userId: string,
  kind: BulkKind,
  id: string,
  trips: () => ReturnType<typeof tripProposals>
): Promise<BulkResult> {
  switch (kind) {
    case "review":
      await dismissFinding(id, userId, {});
      return { kind, id, outcome: "done", undoable: true };
    case "trips": {
      const proposal = (await trips()).find((s) => s.id === id);
      if (!proposal) throw staleError();
      await dismissSuggestion(userId, proposal);
      return { kind, id, outcome: "done" };
    }
    case "updates": {
      if (!(await getPendingUpdateById(id, userId)))
        return { kind, id, outcome: "failed", reason: "NOT_FOUND" };
      if (!(await rejectPendingUpdate(id, userId)))
        return { kind, id, outcome: "failed", reason: "NOT_REJECTED" };
      return { kind, id, outcome: "done" };
    }
    case "photos": {
      const [r] = await reviewPhotoFindings(userId, [{ id, action: "dismiss" }]);
      return r?.outcome === "dismissed"
        ? { kind, id, outcome: "done" }
        : { kind, id, outcome: "failed", reason: (r as { reason?: string })?.reason ?? "failed" };
    }
    case "dawarich":
      await requireStaySuggestionsEnabled(userId);
      await rejectStay(userId, id);
      return { kind, id, outcome: "done" };
    case "location": {
      const { kind: sKind } = await loadSuggestion(userId, id);
      if (sKind === "journey") await closeJourneyRuns(userId, id, undefined);
      else {
        if (sKind === "trip" && !(await tripSuggestionsEnabled(userId)))
          throw new AppError("Trip suggestions are switched off", 409, "TRIP_SUGGESTIONS_DISABLED");
        await rejectSuggestion(userId, id);
        if (sKind === "trip") await recordTravTrackTripDecision(userId, id, "dismissed");
      }
      return { kind, id, outcome: "done" };
    }
  }
}

/** Answer every item on its own, in order; the result names each one's outcome. */
export async function answerInBulk(userId: string, body: BulkBody): Promise<BulkResult[]> {
  let proposals: ReturnType<typeof tripProposals> | null = null;
  const trips = () => (proposals ??= tripProposals(userId));
  const out: BulkResult[] = [];
  const seen = new Set<string>();
  for (const { kind, id } of body.items) {
    if (seen.has(`${kind}:${id}`)) continue;
    seen.add(`${kind}:${id}`);
    try {
      out.push(
        body.action === "accept"
          ? await acceptOne(userId, kind, id)
          : await rejectOne(userId, kind, id, trips)
      );
    } catch (e) {
      out.push({ kind, id, outcome: "failed", reason: reasonOf(e) });
    }
  }
  return out;
}
