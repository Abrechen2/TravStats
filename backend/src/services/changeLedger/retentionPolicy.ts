/**
 * How long an account's change history is kept (owner, 2026-11-23): a rolling
 * window of 3, 6, 12 or 24 months, 12 unless the account chose otherwise.
 * No database import here: the account archive's table policy reads it too.
 */

export const RETENTION_MONTHS_OPTIONS = [3, 6, 12, 24] as const;
export type RetentionMonths = (typeof RETENTION_MONTHS_OPTIONS)[number];
export const DEFAULT_RETENTION_MONTHS: RetentionMonths = 12;

export function isRetentionMonths(value: unknown): value is RetentionMonths {
  return RETENTION_MONTHS_OPTIONS.some((m) => m === value);
}

/**
 * SQL predicate (the account is bound as `$1`) that keeps only the ledger rows
 * still inside the account's window — what the archive may carry even before
 * the nightly job has pruned the rest.
 */
export function retainedLedgerRowsSql(alias: string): string {
  return (
    `${alias}."created_at" >= now() - make_interval(months => COALESCE(` +
    `(SELECT us."change_history_retention_months" FROM "user_settings" us WHERE us."user_id" = $1), ` +
    `${DEFAULT_RETENTION_MONTHS}))`
  );
}
