import { JobLostError, jobErrorCode } from "../../../lib/api/jobs";
import { TimeMigrationContractError } from "../../../lib/api/timeMigration";
import {
  TIME_MIGRATION_REASONS,
  TIME_MIGRATION_TABLES,
  type UnchangedDomain,
  type UnchangedWhy,
} from "../../../types/timeMigration";

type T = (key: string, options?: Record<string, unknown>) => string;

/**
 * Words for the codes the time-migration report, the re-resolution and the
 * inbox's time questions speak (ADR 0002, plan Phase 3b).
 *
 * Tables and reasons are closed vocabularies (`types/timeMigration.ts`, the
 * backend's mirror) and each has DE/EN copy. A code outside them — a server
 * newer than this build — is shown as "unknown (code)": still visible, so the
 * admin can ask about it, and never dressed up as a sentence it is not.
 * Columns are not a closed list; the ones a reader meets are named, any other
 * is the admin's code and the user's plain "a time value".
 */
const COLUMNS = [
  "departure",
  "arrival",
  "visited_at",
  "arrival_time",
  "departure_time",
  "date",
  "day",
  "start_date",
  "end_date",
  "check_in",
  "check_out",
  "birthdate",
] as const;

/** Codes a failed call can carry that these screens have words for. */
const ERROR_CODES = ["DRY_RUN_NOT_FOUND", "RE_RESOLVE_RUNNING"] as const;

/** Codes a failed backfill run reports in `backfill.lastError`. */
const BACKFILL_ERRORS = ["TIMEZONE_LOOKUP_UNAVAILABLE", "JOB_FAILED"] as const;

const known = (list: readonly string[], code: string): boolean => list.includes(code);

function label(t: T, list: readonly string[], group: string, code: string): string {
  return known(list, code)
    ? t(`admin:timeModel.${group}.${code}`)
    : t("admin:timeModel.unknownCode", { code });
}

export const tableLabel = (t: T, code: string): string =>
  label(t, TIME_MIGRATION_TABLES, "tables", code);
export const reasonLabel = (t: T, code: string): string =>
  label(t, TIME_MIGRATION_REASONS, "reasons", code);
export const columnLabel = (t: T, code: string): string => label(t, COLUMNS, "columns", code);
export const backfillErrorLabel = (t: T, code: string): string =>
  label(t, BACKFILL_ERRORS, "backfillErrors", code);
export const unchangedLabel = (t: T, domain: UnchangedDomain, why: UnchangedWhy): string =>
  t("admin:timeModel.report.unchanged.item", {
    domain: t(`admin:timeModel.report.unchanged.domains.${domain}`),
    why: t(`admin:timeModel.report.unchanged.why.${why}`),
  });

/** For the inbox: a column the reader has no word for is "a time value", not a code. */
export const columnLabelForUser = (t: T, code: string): string =>
  known(COLUMNS, code) ? t(`admin:timeModel.columns.${code}`) : t("admin:timeModel.columns.other");

/**
 * The sentence for a failed call. Never the server's prose and never axios'
 * "Request failed with status code 409": a known code gets its own copy, an
 * unreadable answer and a lost job get theirs (a lost job may well have
 * finished — it must not read as "failed"), everything else the caller's
 * fallback.
 */
export function timeModelErrorCopy(err: unknown, t: T, fallbackKey: string): string {
  if (err instanceof TimeMigrationContractError) return t("admin:timeModel.errors.unreadable");
  if (err instanceof JobLostError) return t("admin:timeModel.errors.outcomeUnknown");
  const code = jobErrorCode(err);
  if (code && known(ERROR_CODES, code)) return t(`admin:timeModel.errors.${code}`);
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  if (status === 403) return t("admin:timeModel.errors.forbidden");
  if (status === 404) return t("admin:timeModel.errors.notAvailable");
  return t(fallbackKey);
}

/**
 * An offset change as "+1:00 h" / "−0:30 h" — computed by the server, only
 * printed here, with a real minus sign so a negative delta is not read as a
 * dash. Null (a zone with no instant to measure at) is said in words.
 */
export function formatOffsetDelta(minutes: number | null, t: T): string {
  if (minutes === null) return t("admin:timeModel.reResolve.noInstant");
  const sign = minutes > 0 ? "+" : minutes < 0 ? "−" : "±";
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")} h`;
}
