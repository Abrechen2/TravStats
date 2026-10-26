import { EDIT_PARAM } from "../../lib/editDeepLink";
import {
  RECORD_CHECK_KINDS,
  type DataQualityFlag,
  type RecordCheckKind,
  type RelatedRecord,
} from "../../types/dataQuality";

/**
 * Where a record check (forgejo#282) sends the user — the record's own page,
 * or its editor when the answer is a field to fill.
 *
 * - **flight_number_missing / airport_unknown / trip_end_missing** open the
 *   editor (`?edit=1`): the answer is a value in that form.
 * - **duplicate_candidate / chronology_conflict / trip_entries_outside /
 *   ferry_match** open the page: the user compares, then edits or deletes
 *   there (a ferry match is also answered in place, with "add to the trip"). A duplicate is
 *   never deleted from the inbox — deleting is the one irreversible answer,
 *   and it belongs on the record the user is looking at.
 *
 * A stay is edited on its lodging; without the lodging's id there is nowhere
 * to go, and the answer is null rather than a dead link.
 */
export function isRecordCheckKind(kind: string): kind is RecordCheckKind {
  return (RECORD_CHECK_KINDS as readonly string[]).includes(kind);
}

const EDITS_IN_FORM = new Set<RecordCheckKind>([
  "flight_number_missing",
  "airport_unknown",
  "trip_end_missing",
]);

type Linkable = Pick<RelatedRecord, "entityId" | "parentId"> & {
  entityType: RelatedRecord["entityType"] | "trip" | "place_visit" | "ferry_journey";
};

export function recordPath(record: Linkable, edit = false): string | null {
  const suffix = edit ? `?${EDIT_PARAM.edit}=1` : "";
  switch (record.entityType) {
    case "flight":
      return `/flights/${record.entityId}${suffix}`;
    case "rail_journey":
      return `/rail/${record.entityId}${suffix}`;
    case "bus_journey":
      return `/bus/${record.entityId}${suffix}`;
    case "ferry_journey":
      return `/ferry/${record.entityId}${suffix}`;
    case "cruise":
      return `/cruises/${record.entityId}${suffix}`;
    case "trip":
      return `/trips/${record.entityId}${suffix}`;
    case "lodging_stay":
      return record.parentId
        ? `/lodging/${record.parentId}?${EDIT_PARAM.editStay}=${record.entityId}`
        : null;
    case "place_visit":
      // A visit is edited on its place — the visit's own editor there.
      return record.parentId
        ? `/places/${record.parentId}?${EDIT_PARAM.editVisit}=${record.entityId}`
        : null;
  }
}

const LINKABLE = new Set([
  "flight",
  "rail_journey",
  "bus_journey",
  "ferry_journey",
  "cruise",
  "trip",
  "lodging_stay",
]);

/** The subject's link for a record-check flag; null for any other kind. */
export function recordFlagSubjectPath(flag: DataQualityFlag): string | null {
  if (!isRecordCheckKind(flag.kind) || !LINKABLE.has(flag.entityType)) return null;
  const parentId = flag.subject && "parentId" in flag.subject ? flag.subject.parentId : null;
  return recordPath(
    { entityType: flag.entityType as Linkable["entityType"], entityId: flag.entityId, parentId },
    EDITS_IN_FORM.has(flag.kind)
  );
}
