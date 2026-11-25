export const MAIL_INTAKE_SERVICE_ID = "mailIntake";
/** Mails read per run and source; the rest waits for the next run. */
export const MAX_MAILS_PER_RUN = 25;
export const PARSE_TIMEOUT_MS = 90_000;
export const POLL_CRON = "*/5 * * * *";
/** Headers judged per run and source by the pre-filter; the rest waits for the next run. */
export const MAX_HEADERS_PER_RUN = 2000;
/** UIDs per header FETCH: one command per batch, never one per mail. */
export const HEADER_BATCH = 250;
export const FETCH_FROM_OPTIONS = ["now", "days_30", "days_90", "days_365"] as const;
export type FetchFrom = (typeof FETCH_FROM_OPTIONS)[number];
