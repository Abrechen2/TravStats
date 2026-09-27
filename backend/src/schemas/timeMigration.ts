import { z } from "./zod";

/**
 * The time-model migration as the admin reads it (ADR 0002 phase 3b).
 *
 * The backfill converts every legacy time value it can and writes one ledger
 * row per value (`time_migration_ledger`). What it could not decide without
 * guessing stays `open` there, with a `reason`, and becomes a question in the
 * owner's data-quality inbox. This file is the vocabulary of both, and the
 * shape of the two admin endpoints that read and correct them:
 *
 * - `GET  /api/v1/admin/time-migration/report`
 * - `POST /api/v1/admin/time-zones/re-resolve?dryRun=true` → job
 * - `POST /api/v1/admin/time-zones/re-resolve/apply` `{dryRunId}` → job
 *
 * Mirrored as plain types at `frontend/src/types/timeMigration.ts` — change
 * both together.
 */

/** The tables the backfill writes; the values are the ledger's `table_name`. */
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
export const timeMigrationTableSchema = z.enum(TIME_MIGRATION_TABLES);
export type TimeMigrationTable = (typeof TIME_MIGRATION_TABLES)[number];

/**
 * Why a value is left open. Each one is something the backfill refused to
 * decide, never a failure of the backfill itself.
 */
export const TIME_MIGRATION_REASONS = [
  /** No coordinates, or the `0,0` placeholder an import writes for "unknown". */
  "no_position",
  /** Coordinates, but the resolver names no zone there (open sea). */
  "zone_unresolved",
  /** A cruise stop whose port could not be matched to the catalogue. */
  "port_unresolved",
  /** A sea day that carries a clock time: at sea there is no zone to read it in. */
  "sea_day_time",
  /** A flight whose time semantics were never classified (`UNKNOWN`). */
  "semantics_unknown",
  /** A stored wall clock the place's zone skipped (spring-forward gap). */
  "local_time_nonexistent",
  /** A place visit whose writer (web wall clock or Companion instant) cannot be established (Q4). */
  "writer_unknown",
  /** A date-only flight whose local day at the airport differs from its UTC day. */
  "date_only_day_differs",
  /** A day stored at 10:00–11:59 UTC: a host at +13/+14 or at −10/−11 wrote it. */
  "day_anchor_ambiguous",
  /** A rail journey stored without its station's zone; its instant may be a wall clock read as UTC. */
  "instant_without_zone",
] as const;
export const timeMigrationReasonSchema = z.enum(TIME_MIGRATION_REASONS);
export type TimeMigrationReason = (typeof TIME_MIGRATION_REASONS)[number];

export const TIME_MIGRATION_STATUSES = ["open", "resolved"] as const;
export const timeMigrationStatusSchema = z.enum(TIME_MIGRATION_STATUSES);
export type TimeMigrationStatus = (typeof TIME_MIGRATION_STATUSES)[number];

/** Where the backfill stands on this instance. */
export const BACKFILL_STATES = ["pending", "running", "completed", "failed"] as const;

/**
 * Domains the backfill looks at and deliberately leaves alone — listed so the
 * report says so instead of staying silent about them.
 */
export const UNCHANGED_DOMAINS = [
  "tours",
  "track_windows",
  "loyalty",
  "country_days",
  "photos",
] as const;
export const UNCHANGED_WHY = [
  /** Already a `DATE` column (a tour's day). */
  "already_dates",
  /** Real instants from a machine (GPS tracks, photo EXIF): nothing to convert. */
  "already_instants",
  /** No time value at all (a loyalty card carries only its status). */
  "no_time_columns",
  /** A UTC day on purpose (ADR 0002 Q3). */
  "utc_by_decision",
] as const;

const count = z.number().int().nonnegative();

export const timeMigrationTableReportSchema = z.object({
  table: timeMigrationTableSchema,
  /** Rows the backfill converted, every value resolved. */
  converted: count,
  /** Rows with at least one value left open. */
  open: count,
  /**
   * Rows whose new columns were already filled when the backfill came — by a
   * phase-2 write path or a seed (the demo account) — and which it therefore
   * left exactly as they were.
   */
  alreadyFilled: count,
  /** Ledger rows per rule and status. `rule` is `<table>.<rule>` or `day.<rule>`. */
  rules: z.array(z.object({ rule: z.string(), status: timeMigrationStatusSchema, count })),
  /** Open ledger rows per reason. */
  reasons: z.array(z.object({ reason: timeMigrationReasonSchema, count })),
});

export const timeMigrationOpenRowSchema = z.object({
  table: timeMigrationTableSchema,
  rowId: z.string(),
  userId: z.string().nullable(),
  column: z.string(),
  rule: z.string(),
  reason: timeMigrationReasonSchema.nullable(),
  /** The legacy value as stored, ISO 8601 (or the raw text of a time-of-day). */
  legacyValue: z.string().nullable(),
  /** What the new column now holds; null when it was left empty. */
  newValue: z.string().nullable(),
  zone: z.string().nullable(),
});
export type TimeMigrationOpenRow = z.infer<typeof timeMigrationOpenRowSchema>;

export const TIME_FLAG_KINDS = [
  "time_zone_unresolved",
  "time_precision_unknown",
  "time_day_ambiguous",
] as const;

export const timeMigrationReportSchema = z
  .object({
    backfill: z.object({
      state: z.enum(BACKFILL_STATES),
      /** `AdminSettings.time_model_backfill_at`. */
      completedAt: z.string().datetime().nullable(),
      /** The failed run's stable code (`TIMEZONE_LOOKUP_UNAVAILABLE`, `JOB_FAILED`, …). */
      lastError: z.string().nullable(),
      /** The runtime's tzdata (`process.versions.tz`) the conversion used. */
      tzdata: z.string().nullable(),
    }),
    tables: z.array(timeMigrationTableReportSchema),
    unchanged: z.array(z.object({ domain: z.enum(UNCHANGED_DOMAINS), why: z.enum(UNCHANGED_WHY) })),
    /** The inbox questions the backfill raised, across every account. */
    flags: z.object({
      open: count,
      resolved: count,
      dismissed: count,
      byKind: z.array(z.object({ kind: z.enum(TIME_FLAG_KINDS), open: count })),
    }),
    /** Every open ledger row, oldest table first; capped (see `openRowsTruncated`). */
    openRows: z.array(timeMigrationOpenRowSchema),
    openRowsTruncated: z.boolean(),
  })
  .openapi("TimeMigrationReport");
export type TimeMigrationReport = z.infer<typeof timeMigrationReportSchema>;

/** The tables whose stored zone the admin re-resolution checks (ADR 0002 D2). */
export const RE_RESOLVE_TABLES = [
  "flights",
  "rail_journeys",
  "place_visits",
  "cruise_stops",
  "cruises",
  "trip_stops",
  "lodging_stays",
] as const;
export const reResolveTableSchema = z.enum(RE_RESOLVE_TABLES);
export type ReResolveTable = (typeof RE_RESOLVE_TABLES)[number];

export const reResolveChangeSchema = z.object({
  table: reResolveTableSchema,
  rowId: z.string(),
  /** The zone column that would change, e.g. `dep_timezone`, `stop_zone`. */
  column: z.string(),
  storedZone: z.string(),
  resolvedZone: z.string(),
  /** The stored instant the delta is measured at; null for a zone without one. */
  instant: z.string().datetime().nullable(),
  /**
   * How far the displayed local time moves at `instant` (resolved offset minus
   * stored offset, minutes). The instant itself is kept — it is the stored
   * truth (D1) — so this is exactly what a user would see change.
   */
  offsetDeltaMinutes: z.number().int().nullable(),
});
export type ReResolveChange = z.infer<typeof reResolveChangeSchema>;

export const reResolveDryRunSchema = z
  .object({
    dryRunId: z.string().uuid(),
    tzdata: z.string().nullable(),
    createdAt: z.string().datetime(),
    /** Valid until then; `apply` refuses an expired id with `DRY_RUN_NOT_FOUND`. */
    expiresAt: z.string().datetime(),
    tables: z.array(
      z.object({
        table: reResolveTableSchema,
        checked: count,
        changes: count,
        /** Rows with a stored zone the resolver cannot answer for now; kept, never cleared. */
        unresolvable: count,
      })
    ),
    changes: z.array(reResolveChangeSchema),
    /** `changes` is capped; the counts above are not. Apply covers every change. */
    changesTruncated: z.boolean(),
  })
  .openapi("TimeZoneReResolveDryRun");
export type ReResolveDryRun = z.infer<typeof reResolveDryRunSchema>;

export const reResolveApplySchema = z
  .object({
    dryRunId: z.string().uuid(),
    applied: count,
    /** Rows whose stored zone moved since the dry run; left alone. */
    skippedChanged: count,
  })
  .openapi("TimeZoneReResolveApply");
export type ReResolveApply = z.infer<typeof reResolveApplySchema>;

export const reResolveApplyBodySchema = z.object({ dryRunId: z.string().uuid() });
export const reResolveQuerySchema = z.object({ dryRun: z.literal("true") });
