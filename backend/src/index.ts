import express from "express";
import cors from "cors";
import { corsOriginCheck } from "./middleware/corsOrigin";
import helmet from "helmet";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { recheckAchievementsAfterWrite } from "./middleware/recheckAchievementsAfterWrite";
import { apiMounts } from "./routes/mounts";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestLoggerMiddleware } from "./middleware/requestLogger";
import { prisma } from "./db";
import logger from "./utils/logger";
import { DATABASE_URL } from "./utils/database";
import { resolveTrustProxy } from "./utils/trustProxy";
import { runZoneSelfCheck } from "./shared/time/zoneOf";
import { backupZone } from "./shared/time/schedulerZone";
import { healthHandler } from "./routes/health";
import { templateRegistry } from "./services/parsers/templates/registry";
import { seedPortsFromCSV } from "./seedPortsFromCSV";
import { seedShipsFromCSV } from "./seedShipsFromCSV";
import { seedRailStations } from "./seedRailStations";
import { seedRailStationCodes } from "./seedRailStationCodes";
import { seedLodgingChainsFromCSV } from "./seedLodgingChainsFromCSV";
import { seedCuratedPlacesFromCSV } from "./seedCuratedPlacesFromCSV";
import { seedAirlinesFromData } from "./seedAirlinesFromData";
import { seedAircraftFromData } from "./seedAircraftFromData";

// Load environment variables
dotenv.config();

// Validate environment variables
import { validateEnv } from "./config/env";
try {
  validateEnv();
} catch (error) {
  logger.error({
    operation: "server_start_env_validation_failed",
    message: "Failed to start server due to environment variable validation errors",
    error: {
      message: error instanceof Error ? error.message : "Unknown error",
    },
  });
  process.exit(1);
}

// Set DATABASE_URL from individual components if not already set
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = DATABASE_URL;
}

const app = express();
const PORT = parseInt(process.env.PORT || "8000", 10);

// Whose X-Forwarded-For to believe. Default: the container's own nginx only.
// A further reverse proxy (NPM, Traefik, Caddy) must be NAMED in TRUST_PROXY,
// or every visitor shares its address and its rate-limit buckets — see
// utils/trustProxy.ts for the prod measurement and why `true` is refused.
app.set("trust proxy", resolveTrustProxy(process.env.TRUST_PROXY));

// Security middleware with CSP configuration
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for React
        scriptSrc: ["'self'"], // Only allow scripts from same origin
        imgSrc: ["'self'", "data:", "https:"], // Allow images from same origin, data URIs, and HTTPS
        connectSrc: ["'self'"], // API calls to same origin
        fontSrc: ["'self'", "data:"], // Fonts from same origin and data URIs
        objectSrc: ["'none'"], // Disallow plugins
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"], // Disallow iframes
        upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null, // Upgrade HTTP to HTTPS in production
      },
    },
    crossOriginEmbedderPolicy: false, // Disable COEP to allow external resources if needed
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin resources
  })
);

/**
 * CORS
 *
 * Default (production): **disabled** because TravStats is intended to be served same-origin
 * behind a reverse proxy (nginx / proxy manager). Same-origin requests don't need CORS.
 *
 * Enable CORS explicitly by setting `CORS_ORIGIN` (comma-separated list or '*').
 * In development we default to Vite on localhost.
 */
const corsOrigin =
  process.env.CORS_ORIGIN ??
  (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : undefined);

if (corsOrigin) {
  app.use(cors({ origin: corsOriginCheck(corsOrigin), credentials: true }));
} else {
  logger.info({
    operation: "cors_disabled",
    message:
      "CORS disabled (production same-origin default). Set CORS_ORIGIN to enable cross-origin access.",
  });
}

import { RATE_LIMITS, FILE_LIMITS } from "./config/constants";
import { skipGlobalRateLimit } from "./middleware/rateLimit";

// Rate limiting. `skipGlobalRateLimit` (middleware/rateLimit.ts) says who is
// let through uncounted, and why it is nobody in production.
const limiter = rateLimit({
  windowMs: RATE_LIMITS.GENERAL_WINDOW_MS,
  max:
    process.env.NODE_ENV === "production"
      ? RATE_LIMITS.GENERAL_MAX_REQUESTS
      : RATE_LIMITS.GENERAL_MAX_REQUESTS_DEV,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => skipGlobalRateLimit(req.ip),
});
app.use("/api/", limiter);

// Body parsing with increased limits for email imports
app.use(express.json({ limit: FILE_LIMITS.JSON_BODY_MAX_SIZE }));
app.use(express.urlencoded({ extended: true, limit: FILE_LIMITS.URLENCODED_BODY_MAX_SIZE }));

// Cookie parsing (for HttpOnly JWT cookies)
app.use(cookieParser());

// Request logging middleware (with correlation IDs)
app.use(requestLoggerMiddleware);

// Version detection (routes/version.ts): single source of truth is
// /app/backend/VERSION, loaded by ./utils/version. The Dockerfile writes that file from the
// build-arg (carries any `-rc.N` / `-security-rc.N` suffix). `appVersion`
// is the cleaned display string with pre-release suffix stripped, so a
// byte-identical RC promoted to `:latest` shows the clean release version
// in About even though the binary is the RC build. `buildVersion` is the
// raw file contents for diagnostics.

// Private by default: every API response is no-store unless its handler
// deliberately opts into caching. UAT on the public beta found Cloudflare
// serving GET /api/v1/auth/passkeys from a shared 4-hour edge cache — the
// origin sent no Cache-Control, so the CDN cached a per-user response and could
// hand one account's data to another. This closes it at the source, for every
// deployment and every caching layer, not just this instance's Cloudflare rule.
//
// Mounted ABOVE the health routes so it covers EVERY /api response. Handlers
// that legitimately cache (airline logos, the Immich asset proxy) call
// res.setHeader('Cache-Control', 'private, max-age=…') AFTER this runs and thus
// override it — and `private` already keeps those out of shared caches.
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Health check — see routes/health.ts (reports a broken time zone lookup).
app.get("/health", healthHandler);
app.get("/api/v1/health", healthHandler);

// The public version endpoint lives in routes/version.ts (mount table).

// Public parser-capabilities endpoint. Lets the email import UI say why a
// parse may be templates-only — no model configured, or one switched off.
// Non-sensitive: two booleans about instance configuration.
app.get("/api/v1/parser-capabilities", async (_req, res, next) => {
  try {
    const { getParserCapabilities } = await import("./services/llm/parserCapabilities");
    res.json(await getParserCapabilities());
  } catch (error) {
    next(error);
  }
});

// API routes — the ordered mount table lives in routes/mounts.ts so the
// OpenAPI coverage guard can walk exactly what the app serves. Order is
// significant; the reasons are documented next to each entry there.
app.use(
  ["/api/v1/roadtrips", "/api/v1/tours", "/api/v1/trips/:id/routes", "/api/v1/rail"],
  recheckAchievementsAfterWrite
);
for (const { base, router } of apiMounts) {
  app.use(base, router);
}

// 404 handler for unmatched routes (must be before errorHandler)
app.use(notFoundHandler);

// Error handling
app.use(errorHandler);

// Global error handlers — prevent silent crashes from async scheduler errors
process.on("unhandledRejection", (reason: unknown) => {
  logger.error({
    operation: "unhandled_rejection",
    message: "Unhandled promise rejection",
    error: {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    },
  });
});

process.on("uncaughtException", (error: Error) => {
  logger.error({
    operation: "uncaught_exception",
    message: "Uncaught exception — process will exit",
    error: {
      message: error.message,
      stack: error.stack,
    },
  });
  process.exit(1);
});

// Graceful shutdown — one path for both signals, so a scheduler added to one
// list cannot be forgotten in the other.
const shutdown = (signal: string) => async (): Promise<void> => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  (await import("./services/backupScheduler")).stopScheduler();
  (await import("./jobs/historicalEnrichmentScheduler")).stopHistoricalEnrichmentScheduler();
  (await import("./services/reminderScheduler")).stopReminderScheduler();
  (await import("./jobs/usageStatsScheduler")).stopUsageStatsScheduler();
  (await import("./jobs/airlineLogoRefreshScheduler")).stopAirlineLogoRefreshScheduler();
  (await import("./jobs/statusSweepScheduler")).stopStatusSweepScheduler();
  (await import("./jobs/placeAddressBackfillScheduler")).stopPlaceAddressBackfillScheduler();
  (await import("./jobs/stayFxBackfillScheduler")).stopStayFxBackfillScheduler();
  (await import("./jobs/dataQualitySweepScheduler")).stopDataQualitySweepScheduler();
  (await import("./jobs/dawarichCountryDaySweepScheduler")).stopDawarichCountryDaySweepScheduler();
  (await import("./jobs/documentSweepScheduler")).stopDocumentSweepScheduler();
  (await import("./jobs/photoJourneyScanScheduler")).stopPhotoJourneyScanScheduler();
  (await import("./jobs/logRetentionScheduler")).stopLogRetentionScheduler();
  (await import("./jobs/syncRetentionScheduler")).stopSyncRetentionScheduler();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown("SIGINT"));
process.on("SIGTERM", shutdown("SIGTERM"));

// Start server only if not in test mode
if (process.env.NODE_ENV !== "test") {
  const HOST = process.env.HOST || "0.0.0.0"; // Bind to all interfaces for network access
  app.listen(PORT, HOST, async () => {
    logger.info({
      message: "TravStats backend started",
      host: HOST,
      port: PORT,
      environment: process.env.NODE_ENV,
      nodeVersion: process.version,
    });

    // The admin's logging settings — level, category files, HTTP/query logs —
    // are applied to the running loggers before anything else logs. They used
    // to be stored and never applied (audit 2026-09-26).
    try {
      const { applyLoggingConfig } = await import("./services/loggingConfig");
      await applyLoggingConfig();
    } catch (error) {
      logger.warn({ operation: "server_start_logging_config_error", error });
    }

    // The sync feed's triggers (forgejo#157): a database restored from an
    // older backup can lack them while every table is there, and the feed then
    // reports "nothing changed" forever. The answer is on /health.
    try {
      const { runSyncSchemaCheck } = await import("./services/sync/schemaCheck");
      await runSyncSchemaCheck();
    } catch (error) {
      logger.error({ operation: "server_start_sync_schema_check_error", error });
    }

    // Ensure achievement definitions are present (idempotent upsert)
    try {
      const { ensureAchievements } = await import("./data/achievements");
      await ensureAchievements();
      logger.info({ operation: "server_start_achievements", message: "Achievements ensured" });
    } catch (error) {
      logger.error({
        operation: "server_start_achievements_error",
        message: "Failed to ensure achievements",
        error,
      });
    }

    // The catalogue seeds: cruise ports and ships, the rail station catalogue
    // (Trainline, ODbL) and the lodging chains. Each is idempotent — it
    // inserts missing rows only and never touches a user-added one — and a
    // failure is logged without stopping the ones after it.
    const catalogueSeeds: Array<[string, () => Promise<unknown>]> = [
      ["ports", seedPortsFromCSV],
      ["ships", seedShipsFromCSV],
      ["rail_stations", seedRailStations],
      // After the catalogue: it writes onto the rows the line above inserted.
      ["rail_station_codes", seedRailStationCodes],
      ["lodging_chains", seedLodgingChainsFromCSV],
    ];
    for (const [name, seed] of catalogueSeeds) {
      try {
        await seed();
        logger.info({ operation: `server_start_seed_${name}`, message: `Seeded ${name}` });
      } catch (error) {
        logger.warn({
          operation: `server_start_seed_${name}_error`,
          message: `Failed to seed ${name}`,
          error: { message: error instanceof Error ? error.message : "Unknown error" },
        });
      }
    }

    // Seed the shipped POI checklists. Unlike the catalogs above this one
    // UPDATES existing rows — the targets are reference data nobody can edit,
    // and lazy materialisation makes a corrected coordinate here the only way a
    // fix reaches an existing subscriber. Ticked places are never touched.
    try {
      await seedCuratedPlacesFromCSV();
      logger.info({
        operation: "server_start_seed_curated_places",
        message: "Curated checklists seeded",
      });
    } catch (error) {
      logger.warn({
        operation: "server_start_seed_curated_places_error",
        message: "Failed to seed curated checklists from CSV",
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }

    try {
      await seedAirlinesFromData();
      logger.info({ operation: "server_start_seed_airlines", message: "Airlines seeded" });
    } catch (error) {
      logger.warn({
        operation: "server_start_seed_airlines_error",
        message: "Failed to seed airlines",
        error: { message: error instanceof Error ? error.message : "Unknown error" },
      });
    }

    try {
      await seedAircraftFromData();
      logger.info({ operation: "server_start_seed_aircraft", message: "Aircraft seeded" });
    } catch (error) {
      logger.warn({
        operation: "server_start_seed_aircraft_error",
        message: "Failed to seed aircraft",
        error: { message: error instanceof Error ? error.message : "Unknown error" },
      });
    }

    try {
      const { preloadAirlineCatalog } = await import("./services/airlineCatalogCache");
      const { preloadAircraftCatalog } = await import("./services/aircraftCatalogCache");
      await preloadAirlineCatalog();
      await preloadAircraftCatalog();
      logger.info({
        operation: "server_start_catalog_preload",
        message: "Airline+aircraft caches preloaded",
      });
    } catch (error) {
      logger.warn({
        operation: "server_start_catalog_preload_error",
        message: "Failed to preload catalogues",
        error,
      });
    }

    try {
      const { backfillAirlineCodes } = await import("./scripts/backfillAirlineCodes");
      const n = await backfillAirlineCodes();
      if (n > 0)
        logger.info({
          operation: "server_start_backfill_airline_codes",
          message: `Backfilled ${n} flights`,
        });
    } catch (error) {
      logger.warn({
        operation: "server_start_backfill_airline_codes_error",
        message: "Failed to backfill airline codes",
        error,
      });
    }

    // Normalise stored aircraft types to the catalogue's canonical names
    // (idempotent). normalizeAircraft only ever ran on the write path, so
    // older libraries mix "Airbus A350-900", "B737-800" and "A320neo" in one
    // column. Unrecognised types are left untouched.
    try {
      const { backfillAircraftNames } = await import("./scripts/backfillAircraftNames");
      const n = await backfillAircraftNames();
      if (n > 0)
        logger.info({
          operation: "server_start_backfill_aircraft_names",
          message: `Normalised ${n} flights`,
        });
    } catch (error) {
      logger.warn({
        operation: "server_start_backfill_aircraft_names_error",
        message: "Failed to normalise aircraft names",
        error,
      });
    }

    // Flag a demo account that a pre-2.5.0 version created unflagged
    // (idempotent). Deliberately outside the demo seeder: that seeder runs only
    // on a first install or with CREATE_DEMO_USER=true, i.e. never on the
    // installs that carry the broken row.
    try {
      const { backfillDemoFlag } = await import("./scripts/backfillDemoFlag");
      const n = await backfillDemoFlag();
      if (n > 0) {
        logger.info({
          operation: "server_start_backfill_demo_flag",
          message: "Flagged the built-in demo account as a demo account",
        });
      }
    } catch (error) {
      logger.warn({
        operation: "server_start_backfill_demo_flag_error",
        message: "Failed to flag the demo account",
        error,
      });
    }

    // Backfill booking-level prices (idempotent — heals bookings created
    // priceless by pre-2.5 imports; spec 2026-07-17-cost-booking-price)
    try {
      const { backfillBookingPrices } = await import("./scripts/backfillBookingPrices");
      const healed = await backfillBookingPrices();
      if (healed > 0) {
        logger.info({
          operation: "server_start_backfill_booking_prices",
          message: `Healed ${healed} bookings`,
        });
      }
    } catch (error) {
      logger.warn({
        operation: "server_start_backfill_booking_prices_error",
        message: "Failed to backfill booking prices",
        error,
      });
    }

    // Convert legacy free-text companion arrays on flights/trips/cruises into
    // Companion entities + link rows (idempotent — see backfillCompanions.ts)
    try {
      const { backfillCompanions } = await import("./scripts/backfillCompanions");
      const n = await backfillCompanions();
      if (n > 0) {
        logger.info({
          operation: "server_start_backfill_companions",
          message: `Linked ${n} companion rows`,
        });
      }
    } catch (error) {
      logger.warn({
        operation: "server_start_backfill_companions_error",
        message: "Failed to backfill companions",
        error,
      });
    }

    // Retry the lodging locations no synchronous attempt could resolve.
    // NOT awaited: Nominatim allows 1 req/s, so this can run for minutes and
    // must never hold up boot. It swallows its own errors; the `.catch` is the
    // independent backstop that keeps an unhandled rejection from killing the
    // process (same discipline as the import route's fire-and-forget).
    void import("./services/lodging/geocodeBackfill")
      .then(({ backfillAllLodgingLocations }) => backfillAllLodgingLocations())
      .catch((error: unknown) => {
        logger.warn({
          operation: "server_start_backfill_lodging_locations_error",
          message: "Failed to backfill lodging locations",
          error: error instanceof Error ? error.message : String(error),
        });
      });

    // Normalize aircraft type names in existing flights (idempotent)
    try {
      const { normalizeAircraft } = await import("./utils/aircraftNormalize");
      const flightsWithAircraft = await prisma.flight.findMany({
        where: { aircraft: { not: null } },
        select: { id: true, aircraft: true },
      });
      let aircraftUpdated = 0;
      for (const f of flightsWithAircraft) {
        if (!f.aircraft) continue;
        const normalized = normalizeAircraft(f.aircraft);
        if (normalized !== f.aircraft) {
          await prisma.flight.update({ where: { id: f.id }, data: { aircraft: normalized } });
          aircraftUpdated++;
        }
      }
      if (aircraftUpdated > 0) {
        logger.info({
          operation: "server_start_aircraft_normalize",
          message: `Normalized ${aircraftUpdated} aircraft type names`,
        });
      }
    } catch (error) {
      logger.warn({
        operation: "server_start_aircraft_normalize_error",
        message: "Failed to normalize aircraft names",
        error,
      });
    }

    // nextApiCheckAt for scheduled flights: fill the missing ones, and pull
    // a future flight's stored check forward to the current schedule (never
    // later) — flights stored before the push checkpoints keep D-30min else.
    try {
      const { backfillNextApiCheckAt } = await import("./services/nextApiCheckBackfill");
      const r = await backfillNextApiCheckAt();
      if (r.filled + r.pulledEarlier + r.skipped > 0) {
        logger.info({
          operation: "server_start_backfill_api_check",
          message: `nextApiCheckAt: filled ${r.filled}, pulled earlier ${r.pulledEarlier} of ${r.candidates} scheduled flights (${r.skipped} ineligible)`,
          context: r,
        });
      }
    } catch (error) {
      logger.warn({
        operation: "server_start_backfill_api_check_error",
        message: "Failed to backfill nextApiCheckAt",
        error,
      });
    }

    // The zone lookup every local time depends on. A failure is logged at
    // error level and turns /health "degraded"; it does not stop the boot.
    runZoneSelfCheck();
    // Pin the backup job's zone to the host's at boot, logged once.
    backupZone();

    // Airport zones: fill the missing ones, and once per instance re-derive
    // the ones geo-tz's old default folded together (CAMP-03).
    const { refreshAirportTimezonesOnStartup } = await import("./services/airportTimezoneRepair");
    await refreshAirportTimezonesOnStartup();

    // ADR 0002 phase 3b: convert pre-time-model rows once, after the airport
    // zones above (a flight's zone is read from that catalogue). A job, so
    // the boot is not held up; the admin report says how it went.
    try {
      const { startTimeModelBackfillAtBoot } = await import("./services/timeMigration/runner");
      await startTimeModelBackfillAtBoot();
    } catch (error) {
      logger.error({
        operation: "time_model_backfill_start_error",
        message: "Could not start the time-model backfill",
        error,
      });
    }

    // Converge stored temporal statuses with the dates on boot (idempotent —
    // same logic as the hourly sweep, see services/statusSweep.ts).
    try {
      const { sweepStatuses } = await import("./services/statusSweep");
      const counts = await sweepStatuses();
      logger.info({ operation: "server_start_status_sweep", context: counts });
    } catch (error) {
      logger.warn({
        operation: "server_start_status_sweep_error",
        message: "Failed to run boot status sweep",
        error,
      });
    }

    // Re-evaluate achievements for every user. The engine only runs on a flight/cruise
    // write, so a user who adds nothing would keep a badge that a scoring fix has since
    // invalidated (the continent mapping used to call the Arctic "Antarctica" and count a
    // phantom "Middle East" continent). Idempotent: writes nothing when nothing changed.
    try {
      const { recheckAllAchievements } = await import("./scripts/recheckAchievements");
      const { users, failed } = await recheckAllAchievements();
      logger.info({
        operation: "server_start_achievement_recheck",
        message: `Re-evaluated achievements for ${users - failed} of ${users} users`,
        context: { users, failed },
      });
    } catch (error) {
      logger.warn({
        operation: "server_start_achievement_recheck_error",
        message: "Failed to re-evaluate achievements",
        error,
      });
    }

    // Initialize backup scheduler
    try {
      // A process that just booted owns no backup, so anything still marked
      // in-flight is the wreckage of a crash or a kill mid-backup — and it is
      // also the lock every future backup, restore and scheduler run checks.
      // Clear it BEFORE the scheduler starts, or the first nightly run skips.
      const { reconcileInterruptedBackups } = await import("./services/backup/reconcileBackups");
      await reconcileInterruptedBackups("server restart");

      const { startScheduler } = await import("./services/backupScheduler");
      await startScheduler();
    } catch (error) {
      logger.warn({
        operation: "server_start_backup_scheduler_error",
        message: "Failed to start backup scheduler",
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }

    // Start flight update scheduler
    try {
      const { startFlightUpdateScheduler } = await import("./jobs/flightUpdateScheduler");
      // Sweep every 5 minutes — nextApiCheckAt on each flight controls actual timing
      startFlightUpdateScheduler(5);
      logger.info({
        operation: "server_start_flight_update_scheduler",
        message: "Flight update scheduler started",
      });
    } catch (error) {
      logger.warn({
        operation: "server_start_flight_update_scheduler_error",
        message: "Failed to start flight update scheduler",
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }

    // The cron jobs. Each starts on its own: one that fails to start is logged
    // and stops neither the others nor the server. Their UTC slots, and why,
    // are in each module's header (the table is in dataQualitySweepScheduler.ts).
    const jobs: Array<[name: string, start: () => Promise<void>]> = [
      [
        "historical_enrichment",
        async () =>
          (
            await import("./jobs/historicalEnrichmentScheduler")
          ).startHistoricalEnrichmentScheduler(),
      ],
      [
        "airline_logo_refresh",
        async () =>
          (await import("./jobs/airlineLogoRefreshScheduler")).startAirlineLogoRefreshScheduler(),
      ],
      [
        "status_sweep",
        async () => (await import("./jobs/statusSweepScheduler")).startStatusSweepScheduler(),
      ],
      [
        "place_address_backfill",
        async () =>
          (
            await import("./jobs/placeAddressBackfillScheduler")
          ).startPlaceAddressBackfillScheduler(),
      ],
      [
        "stay_fx_backfill",
        async () => (await import("./jobs/stayFxBackfillScheduler")).startStayFxBackfillScheduler(),
      ],
      [
        "data_quality_sweep",
        async () =>
          (await import("./jobs/dataQualitySweepScheduler")).startDataQualitySweepScheduler(),
      ],
      [
        "dawarich_country_day_sweep",
        async () =>
          (
            await import("./jobs/dawarichCountryDaySweepScheduler")
          ).startDawarichCountryDaySweepScheduler(),
      ],
      // Kept originals (forgejo#116), hourly at :25.
      [
        "document_sweep",
        async () => (await import("./jobs/documentSweepScheduler")).startDocumentSweepScheduler(),
      ],
      // Opt-in nightly Foto-Spürhund (forgejo#94), 04:55.
      [
        "photo_journey_scan",
        async () =>
          (await import("./jobs/photoJourneyScanScheduler")).startPhotoJourneyScanScheduler(),
      ],
      // Log retention, daily 03:45 and once now.
      [
        "log_retention",
        async () => (await import("./jobs/logRetentionScheduler")).startLogRetentionScheduler(),
      ],
      // Sync tombstone retention (forgejo#141), daily 03:50 and once now.
      [
        "sync_retention",
        async () => (await import("./jobs/syncRetentionScheduler")).startSyncRetentionScheduler(),
      ],
      [
        "reminder",
        async () => (await import("./services/reminderScheduler")).startReminderScheduler(),
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

    // Start usage-stats scheduler (jittered daily ping — no-op unless the
    // admin has granted consent and TRAVSTATS_STATS_ENDPOINT is configured)
    try {
      const { startUsageStatsScheduler } = await import("./jobs/usageStatsScheduler");
      startUsageStatsScheduler();
    } catch (error) {
      logger.error({ error }, "server_start_usage_stats_scheduler_error");
    }

    // Initialize airline template registry
    try {
      await templateRegistry.initialize();
      logger.info({
        operation: "server_start_template_registry",
        message: "Airline template registry initialized",
      });
    } catch (error) {
      logger.warn({
        operation: "server_start_template_registry_error",
        message: "Failed to initialize airline template registry",
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }
  });
}

export { app };
export default app;
