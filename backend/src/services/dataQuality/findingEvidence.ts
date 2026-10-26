import type { DataQualityFlagPayload } from "../../schemas/dataQualityFlag";
import type { DuplicateEvidence, FindingAction } from "../../schemas/dataQualityFindings";
import type { RecordCheckDomain } from "../../schemas/dataQualityRecordChecks";

/**
 * What a flag offers and shows beyond its stored row (spec C3): the
 * kind-specific answers, and `evidence` — the contract's name for `details`.
 */

/**
 * The record types a duplicate can be MERGED for. Merging moves what hangs
 * off the dropped copies and deletes them through their own delete path; that
 * is written for flights and stays. A rail, bus or cruise copy is answered
 * with `keep`, or deleted on its own page — `merge` is not offered there.
 */
export const MERGEABLE_DUPLICATE_TYPES: ReadonlySet<string> = new Set<RecordCheckDomain>([
  "flight",
  "lodging_stay",
]);

/** The answers `POST /:id/resolve` takes for a flag, beside the plain "corrected". */
export function findingActionsOf(kind: string, entityType: string): FindingAction[] {
  if (kind === "duplicate_candidate") {
    return MERGEABLE_DUPLICATE_TYPES.has(entityType) ? ["keep", "merge"] : ["keep"];
  }
  if (kind === "ferry_match") return ["link"];
  return [];
}

/**
 * A duplicate's copies as the contract names them. The flag sits on every copy
 * but the earliest-created one (`checks/duplicateCandidates.ts`), and `copies`
 * is ordered oldest first, so the suggested copy to keep is the first copy —
 * the entry that was there before the others arrived.
 */
export function duplicateEvidence(
  entityType: RecordCheckDomain,
  entityId: string,
  details: Extract<DataQualityFlagPayload, { kind: "duplicate_candidate" }>["details"],
  mergedAway: readonly string[] = []
): DuplicateEvidence {
  const oldest = [...details.copies].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.entityId.localeCompare(b.entityId)
  )[0];
  return {
    ...details,
    entityType,
    // Once only each: a merge moves the flag onto the kept copy, which its
    // `copies` already name, and the copies it removed live on only in the
    // resolution.
    ids: [...new Set([entityId, ...details.copies.map((copy) => copy.entityId), ...mergedAway])],
    keptId: oldest?.entityId ?? entityId,
    keptReason: "oldest",
    matchedFields: details.matchedOn,
  };
}

/** `evidence` for one stored payload. */
export function evidenceOf(
  payload: DataQualityFlagPayload,
  entityType: string,
  entityId: string,
  resolution: unknown = null
): unknown {
  if (payload.kind === "duplicate_candidate") {
    return duplicateEvidence(
      entityType as RecordCheckDomain,
      entityId,
      payload.details,
      mergedAwayOf(resolution)
    );
  }
  return payload.details;
}

/** The copies a `merge` answer deleted, read from the stored resolution. */
function mergedAwayOf(resolution: unknown): string[] {
  if (typeof resolution !== "object" || resolution === null) return [];
  const merged = (resolution as { merged?: { removedIds?: unknown } }).merged;
  const removed = merged?.removedIds;
  return Array.isArray(removed) ? removed.filter((id): id is string => typeof id === "string") : [];
}
