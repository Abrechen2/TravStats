import logger from "../utils/logger";

/**
 * The cron jobs. Each starts on its own: one that fails to start is logged
 * and stops neither the others nor the server. Their UTC slots, and why,
 * are in each module's header (the table is in dataQualitySweepScheduler.ts).
 *
 * Started once the server listens (`index.ts`), outside tests.
 */
export async function startCronJobs(): Promise<void> {
  const jobs: Array<[name: string, start: () => Promise<void>]> = [
    // Every 5 minutes; each flight's nextApiCheckAt decides the actual timing.
    [
      "flight_update",
      async () => (await import("./flightUpdateScheduler")).startFlightUpdateScheduler(5),
    ],
    [
      "historical_enrichment",
      async () =>
        (await import("./historicalEnrichmentScheduler")).startHistoricalEnrichmentScheduler(),
    ],
    [
      "airline_logo_refresh",
      async () =>
        (await import("./airlineLogoRefreshScheduler")).startAirlineLogoRefreshScheduler(),
    ],
    [
      "status_sweep",
      async () => (await import("./statusSweepScheduler")).startStatusSweepScheduler(),
    ],
    [
      "place_address_backfill",
      async () =>
        (await import("./placeAddressBackfillScheduler")).startPlaceAddressBackfillScheduler(),
    ],
    // Once per boot: recordings stored before the jitter filter (forgejo#319).
    [
      "track_jitter_remeasure",
      async () =>
        (await import("./trackJitterRemeasureScheduler")).startTrackJitterRemeasureScheduler(),
    ],
    // Once per boot: crossings still stored as a straight line (owner, 2026-10-21).
    [
      "ferry_route_backfill",
      async () =>
        (await import("./ferryRouteBackfillScheduler")).startFerryRouteBackfillScheduler(),
    ],
    [
      "stay_fx_backfill",
      async () => (await import("./stayFxBackfillScheduler")).startStayFxBackfillScheduler(),
    ],
    [
      "data_quality_sweep",
      async () => (await import("./dataQualitySweepScheduler")).startDataQualitySweepScheduler(),
    ],
    [
      "dawarich_country_day_sweep",
      async () =>
        (
          await import("./dawarichCountryDaySweepScheduler")
        ).startDawarichCountryDaySweepScheduler(),
    ],
    // Kept originals (forgejo#116), hourly at :25.
    [
      "document_sweep",
      async () => (await import("./documentSweepScheduler")).startDocumentSweepScheduler(),
    ],
    // Opt-in nightly Foto-Spürhund (forgejo#94), 04:55.
    [
      "photo_journey_scan",
      async () => (await import("./photoJourneyScanScheduler")).startPhotoJourneyScanScheduler(),
    ],
    [
      "dawarich_stay_scan",
      async () => (await import("./dawarichStayScheduler")).startDawarichStayScheduler(),
    ],
    // Log retention, daily 03:45 and once now.
    [
      "log_retention",
      async () => (await import("./logRetentionScheduler")).startLogRetentionScheduler(),
    ],
    // Sync tombstone retention (forgejo#141), daily 03:50 and once now.
    [
      "sync_retention",
      async () => (await import("./syncRetentionScheduler")).startSyncRetentionScheduler(),
    ],
    // Per-account WebDAV sync of the account's export, daily 05:15 (forgejo#321).
    ["webdav_sync", async () => (await import("./webdavSyncScheduler")).startWebdavSyncScheduler()],
    // Trip sharing across servers: the outbox, every 30 s and when nudged (forgejo#301).
    [
      "trip_share_delivery",
      async () => (await import("./tripShareDeliveryScheduler")).startTripShareDeliveryScheduler(),
    ],
    [
      "reminder",
      async () => (await import("../services/reminderScheduler")).startReminderScheduler(),
    ],
  ];
  for (const [name, start] of jobs) {
    try {
      await start();
      logger.info({
        operation: `server_start_${name}_scheduler`,
        message: `${name} scheduler started`,
      });
    } catch (error) {
      logger.warn({
        operation: `server_start_${name}_scheduler_error`,
        message: `Failed to start ${name} scheduler`,
        error: { message: error instanceof Error ? error.message : "Unknown error" },
      });
    }
  }
}
