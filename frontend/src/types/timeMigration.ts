/**
 * The time-model migration as the admin reads it (ADR 0002 phase 3b).
 *
 * MIRRORED from `backend/src/schemas/timeMigration.ts` (the zod schemas and
 * the OpenAPI components `TimeMigrationReport`, `TimeZoneReResolveDryRun`,
 * `TimeZoneReResolveApply`) — change both together.
 *
 * - `GET  /api/v1/admin/time-migration/report` → `TimeMigrationReport` (bare)
 * - `POST /api/v1/admin/time-zones/re-resolve?dryRun=true` → 202 `{ jobId }`;
 *   poll `GET /api/v1/jobs/:id`, whose `data.result` is a `ReResolveDryRun`
 * - `POST /api/v1/admin/time-zones/re-resolve/apply` `{ dryRunId }` → 202
 *   `{ jobId }`; the job's `result` is a `ReResolveApply`. Error codes:
 *   `DRY_RUN_NOT_FOUND` (404), `RE_RESOLVE_RUNNING` (409).
 *
 * The inbox side: three new `DataQualityFlag` kinds (`TimeFlagKind`) whose
 * `details` is a `TimeQuestionDetails`, about rows of the new entity types
 * (`TimeFlagEntityType`); their `subject` is `TimeFlagSubject`.
 */

export const TIME_MIGRATION_TABLES = [
  "flights",
  "rail_journeys",
  "place_visits",
  "cruise_stops",
  "cruises",
  "trip_stops",
  "trips",
  "trip_journal_entries",
  "lodging_stays",
  "users",
] as const;
export type TimeMigrationTable = (typeof TIME_MIGRATION_TABLES)[number];

/** Why a value was left open — each needs its own DE/EN sentence. */
export const TIME_MIGRATION_REASONS = [
  "no_position",
  "zone_unresolved",
  "port_unresolved",
  "sea_day_time",
  "semantics_unknown",
  "local_time_nonexistent",
  "writer_unknown",
  "date_only_day_differs",
  "day_anchor_ambiguous",
  "instant_without_zone",
] as const;
export type TimeMigrationReason = (typeof TIME_MIGRATION_REASONS)[number];

/**
 * A reason as the report screen holds it: a code a server newer than this
 * build sends is read as `"other"` (it still gets a sentence and still counts),
 * never as a reason to throw the whole report away.
 */
export type TimeMigrationReportReason = TimeMigrationReason | "other";

export type TimeMigrationStatus = "open" | "resolved";
export type BackfillState = "pending" | "running" | "completed" | "failed";
export type UnchangedDomain = "tours" | "track_windows" | "loyalty" | "country_days" | "photos";
export type UnchangedWhy =
  "already_dates" | "already_instants" | "no_time_columns" | "utc_by_decision";

export const TIME_FLAG_KINDS = [
  "time_zone_unresolved",
  "time_precision_unknown",
  "time_day_ambiguous",
] as const;
export type TimeFlagKind = (typeof TIME_FLAG_KINDS)[number];

export const TIME_FLAG_ENTITY_TYPES = [
  "flight",
  "rail_journey",
  "place_visit",
  "cruise",
  "cruise_stop",
  "trip",
  "trip_stop",
  "trip_journal_entry",
  "lodging_stay",
  "profile",
] as const;
export type TimeFlagEntityType = (typeof TIME_FLAG_ENTITY_TYPES)[number];

/** The record a row is edited on. */
export const TIME_PARENT_TYPES = ["place", "cruise", "trip", "tour", "lodging"] as const;
export type TimeParentType = (typeof TIME_PARENT_TYPES)[number];

export interface TimeMigrationTableReport {
  table: TimeMigrationTable;
  converted: number;
  open: number;
  /** Filled by a phase-2 write path or a seed before the backfill came; left unchanged. */
  alreadyFilled: number;
  rules: Array<{ rule: string; status: TimeMigrationStatus; count: number }>;
  reasons: Array<{ reason: TimeMigrationReportReason; count: number }>;
}

export interface TimeMigrationOpenRow {
  table: TimeMigrationTable;
  rowId: string;
  userId: string | null;
  column: string;
  rule: string;
  /** Null: the server itself does not know the ledger's reason. */
  reason: TimeMigrationReportReason | null;
  legacyValue: string | null;
  newValue: string | null;
  zone: string | null;
  entityType: TimeFlagEntityType;
  parentType: TimeParentType | null;
  parentId: string | null;
  /** The trip the row belongs to — for a tour's stop, the tour's trip. */
  tripId: string | null;
  /** The inbox question this row raised; null when none. */
  flagId: string | null;
  /** Which question it is — decides the editor that answers it; null with `reason`. */
  kind: TimeFlagKind | null;
}

export interface TimeMigrationReport {
  backfill: {
    state: BackfillState;
    completedAt: string | null;
    /** A stable code, never prose. */
    lastError: string | null;
    tzdata: string | null;
  };
  tables: TimeMigrationTableReport[];
  unchanged: Array<{ domain: UnchangedDomain; why: UnchangedWhy }>;
  flags: {
    open: number;
    resolved: number;
    dismissed: number;
    byKind: Array<{ kind: TimeFlagKind; open: number }>;
  };
  openRows: TimeMigrationOpenRow[];
  openRowsTruncated: boolean;
}

export type ReResolveTable =
  | "flights"
  | "rail_journeys"
  | "place_visits"
  | "cruise_stops"
  | "cruises"
  | "trip_stops"
  | "lodging_stays";

export interface ReResolveChange {
  table: ReResolveTable;
  rowId: string;
  column: string;
  storedZone: string;
  resolvedZone: string;
  instant: string | null;
  /** How far the displayed local time moves; the instant is kept. */
  offsetDeltaMinutes: number | null;
}

export interface ReResolveDryRun {
  dryRunId: string;
  tzdata: string | null;
  createdAt: string;
  expiresAt: string;
  tables: Array<{ table: ReResolveTable; checked: number; changes: number; unresolvable: number }>;
  changes: ReResolveChange[];
  changesTruncated: boolean;
}

export interface ReResolveApply {
  dryRunId: string;
  applied: number;
  skippedChanged: number;
}

/** `details` of a time flag. */
export interface TimeQuestionDetails {
  table: TimeMigrationTable;
  fields: Array<{
    column: string;
    reason: TimeMigrationReason;
    legacyValue: string | null;
    keptValue: string | null;
    zone: string | null;
  }>;
}

/** `subject` of a time flag; `parentId` is the record the row is edited on. */
export interface TimeFlagSubject {
  entityType: TimeFlagEntityType;
  entityId: string;
  label: string;
  parentId: string | null;
  parentType: TimeParentType | null;
  tripId: string | null;
}
