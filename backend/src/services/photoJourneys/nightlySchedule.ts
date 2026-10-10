/**
 * When the nightly photo-journey scan runs and how far back it reads
 * (forgejo#94, point 5) — one home for the numbers the scheduler runs on and
 * the settings card tells the user. The slot is read in UTC
 * (`schedulerZone("photoJourneyScan")`); see `jobs/photoJourneyScanScheduler.ts`
 * for why 04:55.
 */
const RUN_HOUR_UTC = 4;
const RUN_MINUTE_UTC = 55;
const DAY_MS = 24 * 60 * 60 * 1000;

export const NIGHTLY_CRON_EXPRESSION = `${RUN_MINUTE_UTC} ${RUN_HOUR_UTC} * * *`;
export const NIGHTLY_WINDOW_DAYS = 400;

/** The next instant the nightly run starts, strictly after `now`. */
export function nextNightlyRunAt(now: Date): Date {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    RUN_HOUR_UTC,
    RUN_MINUTE_UTC
  );
  return new Date(today > now.getTime() ? today : today + DAY_MS);
}
