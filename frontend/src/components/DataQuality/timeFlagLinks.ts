import { EDIT_PARAM } from "../../lib/editDeepLink";

/**
 * Where the user supplies a time or a zone the migration could not work out
 * (ADR 0002, plan Phase 3b) — the editor, not just the page.
 *
 * One home for the rule, read by the inbox card AND the admin report's
 * unresolved list, so the two can never send the same row to two places.
 *
 * - **flight** → the flight editor: the airport (which brings its zone) and
 *   the times are both there.
 * - **cruise_stop** → the cruise editor, which holds the stops: a sea day or
 *   an unresolved port gets its port there.
 * - **trip_stop** → that one stop's editor on the trip timeline.
 * - **place_visit** → for a missing zone the PLACE editor (the zone comes from
 *   the place's coordinates, and a visit has none of its own); for an unknown
 *   time of day that visit's editor.
 *
 * A stop or visit reaches its editor through its parent record. Without the
 * parent id there is nowhere to go, and the answer is null rather than a link
 * to a page that cannot open it — the caller then says so.
 */
export type TimeFlagEntityType = "flight" | "cruise_stop" | "trip_stop" | "place_visit";

export type TimeFlagKind = "time_zone_unresolved" | "time_precision_unknown";

export const TIME_FLAG_ENTITY_TYPES: readonly TimeFlagEntityType[] = [
  "flight",
  "cruise_stop",
  "trip_stop",
  "place_visit",
];

export function isTimeFlagEntityType(value: string): value is TimeFlagEntityType {
  return (TIME_FLAG_ENTITY_TYPES as readonly string[]).includes(value);
}

export function timeValueEditorPath(
  entityType: TimeFlagEntityType,
  entityId: string,
  parentId: string | null,
  kind: TimeFlagKind
): string | null {
  switch (entityType) {
    case "flight":
      return `/flights/${entityId}?${EDIT_PARAM.edit}=1`;
    case "cruise_stop":
      return parentId ? `/cruises/${parentId}?${EDIT_PARAM.edit}=1` : null;
    case "trip_stop":
      return parentId ? `/trips/${parentId}?tab=timeline&${EDIT_PARAM.editStop}=${entityId}` : null;
    case "place_visit":
      if (!parentId) return null;
      return kind === "time_zone_unresolved"
        ? `/places/${parentId}?${EDIT_PARAM.edit}=1`
        : `/places/${parentId}?${EDIT_PARAM.editVisit}=${entityId}`;
  }
}
