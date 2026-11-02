import logger from "../utils/logger";

/** One cron job: how to start it and how to stop it again. */
export interface CronJob {
  name: string;
  start: () => Promise<void> | void;
  stop: () => Promise<void> | void;
}

/**
 * The one list of schedulers. Shutdown walks this same list (`stopCronJobs`),
 * so a scheduler added here cannot be forgotten there — the hand-kept stop
 * list in `index.ts` had drifted by four.
 */
export const CRON_JOBS: CronJob[] = [
  // Every 5 minutes; each flight's nextApiCheckAt decides the actual timing.
  {
    name: "flight_update",
    start: async () => (await import("./flightUpdateScheduler")).startFlightUpdateScheduler(5),
    stop: async () => (await import("./flightUpdateScheduler")).stopFlightUpdateScheduler(),
  },
  {
    name: "historical_enrichment",
    start: async () =>
      (await import("./historicalEnrichmentScheduler")).startHistoricalEnrichmentScheduler(),
    stop: async () =>
      (await import("./historicalEnrichmentScheduler")).stopHistoricalEnrichmentScheduler(),
  },
  {
    name: "aeroapi_tracks",
    start: async () => (await import("./aeroapiTrackScheduler")).startAeroapiTrackScheduler(),
    stop: async () => (await import("./aeroapiTrackScheduler")).stopAeroapiTrackScheduler(),
  },
  {
    name: "airline_logo_refresh",
    start: async () =>
      (await import("./airlineLogoRefreshScheduler")).startAirlineLogoRefreshScheduler(),
    stop: async () =>
      (await import("./airlineLogoRefreshScheduler")).stopAirlineLogoRefreshScheduler(),
  },
  {
    name: "status_sweep",
    start: async () => (await import("./statusSweepScheduler")).startStatusSweepScheduler(),
    stop: async () => (await import("./statusSweepScheduler")).stopStatusSweepScheduler(),
  },
  {
    name: "place_address_backfill",
    start: async () =>
      (await import("./placeAddressBackfillScheduler")).startPlaceAddressBackfillScheduler(),
    stop: async () =>
      (await import("./placeAddressBackfillScheduler")).stopPlaceAddressBackfillScheduler(),
  },
  // Once per boot: recordings stored before the jitter filter (forgejo#319).
  {
    name: "track_jitter_remeasure",
    start: async () =>
      (await import("./trackJitterRemeasureScheduler")).startTrackJitterRemeasureScheduler(),
    stop: async () =>
      (await import("./trackJitterRemeasureScheduler")).stopTrackJitterRemeasureScheduler(),
  },
  // Once per boot: crossings still stored as a straight line (owner, 2026-10-21).
  {
    name: "ferry_route_backfill",
    start: async () =>
      (await import("./ferryRouteBackfillScheduler")).startFerryRouteBackfillScheduler(),
    stop: async () =>
      (await import("./ferryRouteBackfillScheduler")).stopFerryRouteBackfillScheduler(),
  },
  {
    name: "stay_fx_backfill",
    start: async () => (await import("./stayFxBackfillScheduler")).startStayFxBackfillScheduler(),
    stop: async () => (await import("./stayFxBackfillScheduler")).stopStayFxBackfillScheduler(),
  },
  {
    name: "data_quality_sweep",
    start: async () =>
      (await import("./dataQualitySweepScheduler")).startDataQualitySweepScheduler(),
    stop: async () => (await import("./dataQualitySweepScheduler")).stopDataQualitySweepScheduler(),
  },
  {
    name: "dawarich_country_day_sweep",
    start: async () =>
      (await import("./dawarichCountryDaySweepScheduler")).startDawarichCountryDaySweepScheduler(),
    stop: async () =>
      (await import("./dawarichCountryDaySweepScheduler")).stopDawarichCountryDaySweepScheduler(),
  },
  // Kept originals (forgejo#116), hourly at :25.
  {
    name: "document_sweep",
    start: async () => (await import("./documentSweepScheduler")).startDocumentSweepScheduler(),
    stop: async () => (await import("./documentSweepScheduler")).stopDocumentSweepScheduler(),
  },
  // Opt-in nightly Foto-Spürhund (forgejo#94), 04:55.
  {
    name: "photo_journey_scan",
    start: async () =>
      (await import("./photoJourneyScanScheduler")).startPhotoJourneyScanScheduler(),
    stop: async () => (await import("./photoJourneyScanScheduler")).stopPhotoJourneyScanScheduler(),
  },
  {
    name: "dawarich_stay_scan",
    start: async () => (await import("./dawarichStayScheduler")).startDawarichStayScheduler(),
    stop: async () => (await import("./dawarichStayScheduler")).stopDawarichStayScheduler(),
  },
  // Log retention, daily 03:45 and once now.
  {
    name: "log_retention",
    start: async () => (await import("./logRetentionScheduler")).startLogRetentionScheduler(),
    stop: async () => (await import("./logRetentionScheduler")).stopLogRetentionScheduler(),
  },
  // Sync tombstone retention (forgejo#141), daily 03:50 and once now.
  {
    name: "sync_retention",
    start: async () => (await import("./syncRetentionScheduler")).startSyncRetentionScheduler(),
    stop: async () => (await import("./syncRetentionScheduler")).stopSyncRetentionScheduler(),
  },
  // TravTrack diagnostics log retention, daily 03:40 and once now.
  {
    name: "travtrack_diagnostics_retention",
    start: async () =>
      (
        await import("./travTrackDiagnosticsRetentionScheduler")
      ).startTravTrackDiagnosticsRetentionScheduler(),
    stop: async () =>
      (
        await import("./travTrackDiagnosticsRetentionScheduler")
      ).stopTravTrackDiagnosticsRetentionScheduler(),
  },
  // TravTrack links whose flight or trip is gone, daily 03:55 (TravTrack plan T2).
  {
    name: "travtrack_orphan_links",
    start: async () =>
      (await import("./travTrackOrphanLinkScheduler")).startTravTrackOrphanLinkScheduler(),
    stop: async () =>
      (await import("./travTrackOrphanLinkScheduler")).stopTravTrackOrphanLinkScheduler(),
  },
  // TravTrack country days and country questions, every 15 min (TravTrack plan E6).
  {
    name: "travtrack_projections",
    start: async () =>
      (await import("./travTrackProjectionScheduler")).startTravTrackProjectionScheduler(),
    stop: async () =>
      (await import("./travTrackProjectionScheduler")).stopTravTrackProjectionScheduler(),
  },
  // TravTrack trip questions, nightly 04:25 (TravTrack plan L4).
  {
    name: "travtrack_trips",
    start: async () => (await import("./travTrackTripScheduler")).startTravTrackTripScheduler(),
    stop: async () => (await import("./travTrackTripScheduler")).stopTravTrackTripScheduler(),
  },
  // Per-account WebDAV sync of the account's export, daily 05:15 (forgejo#321).
  {
    name: "webdav_sync",
    start: async () => (await import("./webdavSyncScheduler")).startWebdavSyncScheduler(),
    stop: async () => (await import("./webdavSyncScheduler")).stopWebdavSyncScheduler(),
  },
  // Trip sharing across servers: the outbox, every 30 s and when nudged (forgejo#301).
  {
    name: "trip_share_delivery",
    start: async () =>
      (await import("./tripShareDeliveryScheduler")).startTripShareDeliveryScheduler(),
    stop: async () =>
      (await import("./tripShareDeliveryScheduler")).stopTripShareDeliveryScheduler(),
  },
  {
    name: "mail_intake",
    start: async () => (await import("./mailIntakeScheduler")).startMailIntakeScheduler(),
    stop: async () => (await import("./mailIntakeScheduler")).stopMailIntakeScheduler(),
  },
  {
    name: "reminder",
    start: async () => (await import("../services/reminderScheduler")).startReminderScheduler(),
    stop: async () => (await import("../services/reminderScheduler")).stopReminderScheduler(),
  },
];

/**
 * The cron jobs. Each starts on its own: one that fails to start is logged
 * and stops neither the others nor the server. Their UTC slots, and why,
 * are in each module's header (the table is in dataQualitySweepScheduler.ts).
 *
 * Started once the server listens (`index.ts`), outside tests.
 */
export async function startCronJobs(): Promise<void> {
  for (const { name, start } of CRON_JOBS) {
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

/** Stop every scheduler; one that fails to stop is logged and does not block the rest. */
export async function stopCronJobs(): Promise<void> {
  for (const { name, stop } of CRON_JOBS) {
    try {
      await stop();
    } catch (error) {
      logger.warn({
        operation: `server_stop_${name}_scheduler_error`,
        message: `Failed to stop ${name} scheduler`,
        error: { message: error instanceof Error ? error.message : "Unknown error" },
      });
    }
  }
}
