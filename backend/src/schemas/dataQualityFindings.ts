import { z } from "./zod";
import {
  duplicateCandidateDetailsSchema,
  duplicateMatchFieldSchema,
  recordCheckDomainSchema,
} from "./dataQualityRecordChecks";

/**
 * Inbox findings you can ANSWER with an action, and take back (spec
 * 2026-10-25-companion-redesign, C3).
 *
 * A flag used to have two answers, both about the flag: "corrected" and "this
 * is right". C3 adds answers that change data — `merge` two copies, `link` a
 * ride to a trip — plus `keep` ("these are two entries"), and an undo for the
 * answers that are trivially reversible. Owner, 2026-10-25: server undo for
 * `dismiss` and `link`; `merge` has none in this step, the app delays it.
 *
 * Additive throughout: an old client that posts `resolve` with no body gets
 * exactly the old answer.
 */

/**
 * The kind-specific answers. Which ones a flag takes is `actions` on the flag
 * itself, so a client never has to know the table — see `findingActionsOf`.
 */
export const FINDING_ACTIONS = ["keep", "merge", "link"] as const;
export const findingActionSchema = z.enum(FINDING_ACTIONS);
export type FindingAction = (typeof FINDING_ACTIONS)[number];

/**
 * Stable error codes, sent in `error` (the contract's `{ error: "undoExpired" }`).
 *
 * - `notFound` — no such flag for this account (404).
 * - `invalidAction` — the action is unknown or not offered for this flag (400);
 *   `reason` says which.
 * - `undoExpired` — nothing can be taken back any more: the window passed, or
 *   the answer was one with no undo (409).
 * - `staleFinding` — the records or the flag changed since the check ran (409).
 */
export const FINDING_ERRORS = ["notFound", "invalidAction", "undoExpired", "staleFinding"] as const;
export type FindingErrorCode = (typeof FINDING_ERRORS)[number];

/** Why an action was refused as `invalidAction`. */
export const INVALID_ACTION_REASONS = [
  /** The action is not one of `FINDING_ACTIONS`. */
  "unknownAction",
  /** The flag's kind (or its record type) does not take this action — see `actions`. */
  "notOffered",
  /** `keptId` names a record that is not one of the finding's `ids`. */
  "keptIdNotInFinding",
  /** `merge`: more than one copy carries a flight recording — merging would lose one. */
  "conflictingRecordings",
  /** `merge`: the copies sit on different trips, bookings or loyalty cards. */
  "conflictingLinks",
] as const;
export type InvalidActionReason = (typeof INVALID_ACTION_REASONS)[number];

/**
 * `POST /:id/resolve` body. Both fields optional: no `action` is the old
 * answer, "I have corrected the data". `keptId` overrides the suggested copy a
 * `merge` keeps. `action` is a plain string here so an unknown one answers the
 * contract's `invalidAction`, not a generic validation failure.
 */
export const resolveFindingBodySchema = z
  .object({
    action: z.string().min(1).optional(),
    keptId: z.string().min(1).optional(),
    /**
     * The flag's `revision` as the client was served it. When given, the
     * answer applies only to that revision, else `staleFinding`. Optional so
     * an old client keeps working; the server then guards with the revision
     * it read itself.
     */
    revision: z.number().int().min(0).optional(),
  })
  .default({});

/** `dismiss` / `undo` body: only the optional served revision. */
export const answerGuardBodySchema = z
  .object({ revision: z.number().int().min(0).optional() })
  .default({});

/** Why `keptId` is the suggested copy. One rule today: the oldest entry. */
export const KEPT_REASONS = ["oldest"] as const;

/**
 * `evidence` of a `duplicate_candidate` — the contract's `duplicate` evidence
 * (`entityType`, `ids`, `keptId`, `matchedFields`) on top of the stored
 * details, which stay so the web keeps reading what it read.
 */
export const duplicateEvidenceSchema = duplicateCandidateDetailsSchema.extend({
  entityType: recordCheckDomainSchema,
  /** Every copy, this flag's own record first. At least two. */
  ids: z.array(z.string()).min(2),
  /** The copy a `merge` keeps unless the body names another. */
  keptId: z.string(),
  keptReason: z.enum(KEPT_REASONS),
  matchedFields: z.array(duplicateMatchFieldSchema),
});
export type DuplicateEvidence = z.infer<typeof duplicateEvidenceSchema>;

/**
 * What the last answer did, stored on the flag (`resolution`), so `undo` can
 * put it back. Never sent to clients — `undoUntil` is what they read.
 */
export const findingResolutionSchema = z.object({
  action: z.enum(["resolve", "dismiss", "keep", "merge", "link"]),
  previousStatus: z.enum(["open", "resolved", "dismissed"]),
  previousResolvedAt: z.string().nullable(),
  /** `keep`: the other flags of the same copies, answered along with this one. */
  siblings: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(["open", "resolved", "dismissed"]),
        resolvedAt: z.string().nullable(),
        /** The sibling's revision right after this answer — its stamp. */
        revision: z.number().int().optional(),
      })
    )
    .optional(),
  /** `link`: the row and the trip it was put on. */
  link: z.object({ entityType: z.string(), id: z.string(), tripId: z.string() }).optional(),
  /**
   * A duplicate flag created after a `keep` over the same copies is born
   * dismissed and names that answer's flag here; undoing it re-opens this one.
   */
  inheritedFrom: z.string().optional(),
  /** `merge`: a record of what happened. Not undoable. */
  merged: z.object({ keptId: z.string(), removedIds: z.array(z.string()) }).optional(),
});
export type FindingResolution = z.infer<typeof findingResolutionSchema>;
