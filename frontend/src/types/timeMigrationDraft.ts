/**
 * The time-model migration report and the admin zone re-resolution (ADR 0002,
 * plan Phase 3b), as the web reads them.
 *
 * PROVISIONAL: written against the plan's description while the backend half
 * (`GET /admin/time-migration/report`, `POST /admin/time-zones/re-resolve…`)
 * was being built beside it. `lib/api/timeMigration.ts` parses every answer
 * against these shapes, so a server that answers differently shows "the
 * answer could not be read" instead of a table of silent zeros.
 *
 * Every code here (`table`, `rule`, `reason`, `field`) is a word for a
 * program. The screens map the ones they know to DE/EN copy and show an
 * unknown one as "unknown (code)" — never as a sentence it is not.
 */

/** Where the migration stands on this instance. */
export type TimeMigrationStatus = "not_run" | "running" | "done" | "failed";

/**
 * What happened to a group of rows.
 *
 * - `converted` — a value was written into the new columns (the legacy column
 *   is untouched until Phase 6);
 * - `kept` — the stored value already meant what it says; only the zone and
 *   precision were recorded beside it;
 * - `unresolved` — nothing was converted, the row is flagged for its owner.
 */
export type TimeMigrationOutcome = "converted" | "kept" | "unresolved";

/** One line of the count table: rows of one table that one rule handled. */
export interface TimeMigrationCount {
  table: string;
  rule: string;
  /** Why the rule ended where it did; null when there is nothing to explain. */
  reason: string | null;
  outcome: TimeMigrationOutcome;
  count: number;
}

/** A row the migration left untouched, with what the admin needs to reach it. */
export interface TimeMigrationUnresolvedRow {
  /** Same vocabulary as the data-quality flag's entity type. */
  table: string;
  entityId: string;
  /** The record the row lives under (cruise, trip, place); null for a flight. */
  parentId: string | null;
  /** Which time value on the row (`departure`, `visitedAt`, …). */
  field: string;
  reason: string;
  /** The inbox flag raised for it; null if none could be raised. */
  flagId: string | null;
  /**
   * Which question the flag asks: a missing zone sends a place visit to the
   * place's editor (the zone comes from its coordinates), an unknown time of
   * day to the visit's own. Null when no flag was raised.
   */
  flagKind: "time_zone_unresolved" | "time_precision_unknown" | null;
  /** The user's own name for the record, never a code. */
  label: string | null;
  ownerId: string;
  ownerUsername: string;
}

export interface TimeMigrationReport {
  status: TimeMigrationStatus;
  /** When the run finished; null until it has. */
  ranAt: string | null;
  counts: TimeMigrationCount[];
  /** The unresolved rows — possibly the first page of them only. */
  unresolved: TimeMigrationUnresolvedRow[];
  /** How many unresolved rows exist in total (the list above may be capped). */
  unresolvedTotal: number;
}

/** One row whose stored zone the resolver would now answer differently. */
export interface ZoneReResolveChange {
  table: string;
  entityId: string;
  parentId: string | null;
  field: string;
  label: string | null;
  fromZone: string;
  toZone: string;
  /** The stored instant the delta is measured at. */
  at: string;
  /**
   * The change of the local wall clock at that instant, in minutes, as the
   * server computes it (`offset(toZone) − offset(fromZone)`). Zero is real: a
   * zone renamed without moving the clock.
   */
  offsetDeltaMinutes: number;
}

/** What a dry run answers. Nothing is written by it. */
export interface ZoneReResolveDryRun {
  dryRunId: string;
  createdAt: string;
  /** After this the id is refused by `apply`; null = no expiry. */
  expiresAt: string | null;
  scanned: number;
  changes: ZoneReResolveChange[];
  /** All changes, where `changes` may be capped. */
  changesTotal: number;
  /** Rows the resolver could not answer at all — kept as stored, never cleared. */
  unresolvable: number;
}

/** What the apply job reports when it has finished. */
export interface ZoneReResolveApplyResult {
  applied: number;
  /** Rows that changed after the dry run and were therefore left alone. */
  skipped: number;
}
