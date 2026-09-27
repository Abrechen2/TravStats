import { JobLostError, jobErrorCode } from "../../../lib/api/jobs";
import { TimeMigrationContractError } from "../../../lib/api/timeMigration";

type T = (key: string, options?: Record<string, unknown>) => string;

/**
 * Words for the codes the time-migration report and the re-resolution speak.
 *
 * The server sends codes (`place_visit`, `legacy_fake_utc`, `no_position`);
 * the admin reads sentences. A code this build has no copy for is shown as
 * "unknown (code)" — the code stays visible so the admin can still ask about
 * it, and it is never dressed up as a sentence it is not.
 *
 * The lists are the vocabulary of plan Phase 3b as written; the backend half
 * owns the codes, and one it adds later degrades to the "unknown" line
 * instead of a raw key.
 */
const TABLES = [
  "flight",
  "place_visit",
  "cruise_stop",
  "trip_stop",
  "lodging_stay",
  "cruise",
  "trip",
  "journal_entry",
  "user",
] as const;

const RULES = [
  "catalogue_zone",
  "coordinate_zone",
  "utc_kept",
  "legacy_fake_utc",
  "date_only",
  "place_zone",
  "port_zone",
  "written_via",
  "before_companion",
  "sub_minute_instant",
  "http_log",
  "precision_unknown",
  "day_midnight",
  "day_shifted",
  "day_ambiguous",
  "lodging_check_in",
] as const;

const REASONS = [
  "no_position",
  "no_zone",
  "no_coordinates",
  "sea_day",
  "unresolved_port",
  "writer_unknown",
  "ambiguous_day",
  "local_day_differs",
] as const;

const FIELDS = [
  "departure",
  "arrival",
  "visitedAt",
  "arrivalTime",
  "departureTime",
  "date",
  "startDate",
  "endDate",
  "checkIn",
  "checkOut",
] as const;

/** Server codes a failed call can carry that this screen has words for. */
const ERROR_CODES = [
  "DRY_RUN_NOT_FOUND",
  "DRY_RUN_EXPIRED",
  "DRY_RUN_STALE",
  "RE_RESOLVE_RUNNING",
  "TIME_MIGRATION_RUNNING",
] as const;

function known(list: readonly string[], code: string): boolean {
  return list.includes(code);
}

function label(t: T, list: readonly string[], group: string, code: string): string {
  return known(list, code)
    ? t(`admin:timeModel.${group}.${code}`)
    : t("admin:timeModel.unknownCode", { code });
}

export const tableLabel = (t: T, code: string): string => label(t, TABLES, "tables", code);
export const ruleLabel = (t: T, code: string): string => label(t, RULES, "rules", code);
export const reasonLabel = (t: T, code: string): string => label(t, REASONS, "reasons", code);
export const fieldLabel = (t: T, code: string): string => label(t, FIELDS, "fields", code);

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
 * An offset change as "+1:00 h" / "−0:30 h". Computed by the server; this
 * only prints it, with a real minus sign so a negative delta is not read as a
 * dash.
 */
export function formatOffsetDelta(minutes: number): string {
  const sign = minutes > 0 ? "+" : minutes < 0 ? "−" : "±";
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = String(abs % 60).padStart(2, "0");
  return `${sign}${hours}:${rest} h`;
}
