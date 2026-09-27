import { EDIT_PARAM } from "../../lib/editDeepLink";
import type { DataQualityFlag } from "../../types/dataQuality";
import {
  TIME_FLAG_ENTITY_TYPES,
  TIME_FLAG_KINDS,
  type TimeFlagEntityType,
  type TimeFlagKind,
  type TimeParentType,
} from "../../types/timeMigration";

/**
 * Where the user answers a time question the migration left open (ADR 0002,
 * plan Phase 3b) — the editor, not just the page.
 *
 * - **flight, rail_journey, cruise, trip** → the record's own editor, where
 *   the place (which brings its zone) and the times are.
 * - **cruise_stop** → the cruise editor, which holds the stops: a sea day or
 *   an unmatched port gets its port there.
 * - **trip_stop / trip_journal_entry** → that one stop or entry on the trip
 *   timeline (`tripId`); a tour's own point → the tour editor, inside the
 *   tour's trip when it has one.
 * - **place_visit** → for a missing zone the PLACE editor (the zone comes
 *   from the place's coordinates; a visit has none of its own); for an
 *   unknown time of day or an uncertain day, that visit's editor.
 * - **lodging_stay** → that stay's editor on the lodging page.
 * - **profile** → the account settings, where the birthday is.
 *
 * A row edited through its parent needs the parent's id (the subject's
 * `parentId`). Without it there is nowhere to go, and the answer is null
 * rather than a link to a page that cannot open the editor — the caller then
 * says so.
 */
export function isTimeFlagEntityType(value: string): value is TimeFlagEntityType {
  return (TIME_FLAG_ENTITY_TYPES as readonly string[]).includes(value);
}

/** The row a time question is about, and where it lives — the subject, or a report row. */
export interface TimeRowLink {
  entityType: TimeFlagEntityType;
  entityId: string;
  parentType: TimeParentType | null;
  parentId: string | null;
  tripId: string | null;
}

export function timeValueEditorPath(link: TimeRowLink, kind: TimeFlagKind): string | null {
  const { entityType, entityId, parentType, parentId, tripId } = link;
  const edit = `${EDIT_PARAM.edit}=1`;
  switch (entityType) {
    case "flight":
      return `/flights/${entityId}?${edit}`;
    case "rail_journey":
      return `/rail/${entityId}?${edit}`;
    case "cruise":
      return `/cruises/${entityId}?${edit}`;
    case "trip":
      return `/trips/${entityId}?${edit}`;
    case "profile":
      return "/settings/account";
    case "cruise_stop":
      return parentId ? `/cruises/${parentId}?${edit}` : null;
    case "trip_stop":
      // A tour's own point is edited in the tour editor — inside the tour's
      // trip when it has one; every other stop on its trip's timeline.
      if (parentType === "tour") {
        if (!parentId) return null;
        return tripId ? `/trips/${tripId}/route/${parentId}` : `/tours/${parentId}`;
      }
      return (tripId ?? parentId)
        ? `/trips/${tripId ?? parentId}?tab=timeline&${EDIT_PARAM.editStop}=${entityId}`
        : null;
    case "trip_journal_entry":
      return (tripId ?? parentId)
        ? `/trips/${tripId ?? parentId}?tab=timeline&${EDIT_PARAM.editJournal}=${entityId}`
        : null;
    case "lodging_stay":
      return parentId ? `/lodging/${parentId}?${EDIT_PARAM.editStay}=${entityId}` : null;
    case "place_visit":
      if (!parentId) return null;
      return kind === "time_zone_unresolved"
        ? `/places/${parentId}?${edit}`
        : `/places/${parentId}?${EDIT_PARAM.editVisit}=${entityId}`;
  }
}

/** True for the kinds the time-model migration raises. */
export function isTimeFlagKind(kind: string): kind is TimeFlagKind {
  return (TIME_FLAG_KINDS as readonly string[]).includes(kind);
}

/**
 * The editor a time flag sends the user to; null for any other kind, and for
 * a row whose parent record is unknown. `parentId` travels on the subject.
 */
export function timeFlagEditorPath(flag: DataQualityFlag): string | null {
  if (!isTimeFlagKind(flag.kind) || !isTimeFlagEntityType(flag.entityType)) return null;
  const subject = flag.subject && "parentId" in flag.subject ? flag.subject : null;
  return timeValueEditorPath(
    {
      entityType: flag.entityType,
      entityId: flag.entityId,
      parentType: subject?.parentType ?? null,
      parentId: subject?.parentId ?? null,
      tripId: subject?.tripId ?? null,
    },
    flag.kind
  );
}
