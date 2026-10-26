import type { DataQualityFinding } from "./types";

/**
 * What a dismissal answered, for the kinds whose question names OTHER records.
 *
 * A flag's identity is (entity, kind), but "this overlap is fine" is said about
 * one partner, and "these entries belong to the trip" about those entries. When
 * the partner changed or a new entry fell outside the trip, the old dismissal
 * kept the flag quiet, so a question the user had never seen was answered for
 * them. Kinds without such a subject return null and a dismissal stays final.
 */
type Ref = { entityType?: unknown; entityId?: unknown };

const refKey = (ref: Ref | null | undefined): string | null =>
  ref && typeof ref.entityType === "string" && typeof ref.entityId === "string"
    ? `${ref.entityType}:${ref.entityId}`
    : null;

function answeredRecords(kind: string, details: unknown): Set<string> | null {
  if (details === null || typeof details !== "object") return null;
  const shape = details as { conflictWith?: Ref; entries?: unknown };
  if (kind === "chronology_conflict") {
    const key = refKey(shape.conflictWith);
    return key ? new Set([key]) : null;
  }
  // "This crossing does not belong to trip A" says nothing about trip B.
  if (kind === "ferry_match") {
    const tripId = (details as { candidateTripId?: unknown }).candidateTripId;
    return typeof tripId === "string" ? new Set([`trip:${tripId}`]) : null;
  }
  if (kind === "trip_entries_outside" && Array.isArray(shape.entries)) {
    const keys = (shape.entries as Ref[]).map(refKey);
    return keys.every((k): k is string => k !== null) ? new Set(keys) : null;
  }
  return null;
}

/**
 * True when the finding names a record the dismissal did not cover. An entry
 * that dropped out does not count — fewer of the same answered question is
 * still answered. Unreadable stored details keep the dismissal, never reopen.
 */
export function outgrowsDismissal(
  kind: string,
  dismissedDetails: unknown,
  finding: DataQualityFinding
): boolean {
  const answered = answeredRecords(kind, dismissedDetails);
  const asked = answeredRecords(kind, finding.details);
  if (!answered || !asked) return false;
  return [...asked].some((key) => !answered.has(key));
}
