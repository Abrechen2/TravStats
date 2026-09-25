import express, { Request, Response } from "express";
import cors from "cors";
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
import { appVersion, buildVersion } from "./utils/version";
import { resolveTrustProxy } from "./utils/trustProxy";
import { templateRegistry } from "./services/parsers/templates/registry";
import { seedPortsFromCSV } from "./seedPortsFromCSV";
import { seedShipsFromCSV } from "./seedShipsFromCSV";
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
  const allowedOrigins =
    corsOrigin === "*"
      ? []
      : corsOrigin
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean);
  const allowAllOrigins = corsOrigin === "*";

  app.use(
    cors({
      origin: (origin, callback) => {
        if (allowAllOrigins) return callback(null, true);
        // Allow requests without origin (mobile apps, server-to-server, etc.)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
    })
  );
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

// Version detection: single source of truth is /app/backend/VERSION,
// loaded by ./utils/version. The Dockerfile writes that file from the
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

// Health check — mounted at both `/health` (legacy, used by the Dockerfile
// HEALTHCHECK and the nginx upstream probe) and `/api/v1/health` (versioned,
// matches the public-API URL convention documented for external callers).
const healthHandler = (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), version: appVersion });
};
app.get("/health", healthHandler);
app.get("/api/v1/health", healthHandler);

// Public version endpoint — unauthenticated so the About section can
// show the right version even before login. Returns both the runtime
// version (what the user sees) and the build version baked into the
// image (kept for diagnostics, only shown when it differs). Also
// surfaces the latest stable GitHub release so the UI can show an
// update banner. Network failures degrade to latestAvailable=null so
// air-gapped installs simply hide the banner.
app.get("/api/v1/version", async (_req, res) => {
  const { getCachedLatestRelease, isUpdateAvailable } = await import("./services/updateChecker");
  const latest = await getCachedLatestRelease();

  res.json({
    version: appVersion,
    buildVersion,
    latestAvailable: latest?.latestAvailable ?? null,
    updateAvailable: latest ? isUpdateAvailable(appVersion, latest.latestAvailable) : false,
    releaseUrl: latest?.releaseUrl ?? null,
    releaseNotes: latest?.releaseNotes ?? null,
    publishedAt: latest?.publishedAt ?? null,
  });
});

// Public parser-capabilities endpoint. Lets the email import UI show
// an accuracy warning when no LLM is wired up. Non-sensitive — just
// a boolean reflecting the instance-wide admin setting.
app.get("/api/v1/parser-capabilities", async (_req, res, next) => {
  try {
    /**
     * Answered from the SAME resolution the parser uses.
     *
     * Forgejo #12: this read `admin_settings` alone, while `getParserConfig`
     * also falls back to OLLAMA_URL / OLLAMA_MODEL from the environment. On any
     * instance configured through env — which is how the test VM installer sets
     * it up — the import screen said "Kein LLM-Parser verfuegbar" while the
     * very next request came back labelled `ollama` with 85% confidence, and
     * the server log agreed with the parser.
     *
     * Two sources of truth for one question is how they disagreed. There is now
     * one, and the user cannot be told the opposite of what happens.
     */
    const { getParserConfig } = await import("./services/parsers/config");
    const config = await getParserConfig();
    res.json({ hasLlm: Boolean(config.ollamaUrl && config.ollamaModel) });
  } catch (error) {
    next(error);
  }
});

// API routes — the ordered mount table lives in routes/mounts.ts so the
// OpenAPI coverage guard can walk exactly what the app serves. Order is
// significant; the reasons are documented next to each entry there.
app.use(
  ["/api/v1/roadtrips", "/api/v1/tours", "/api/v1/trips/:id/routes"],
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
  (await import("./jobs/dataQualitySweepScheduler")).stopDataQualitySweepScheduler();
  (await import("./jobs/dawarichCountryDaySweepScheduler")).stopDawarichCountryDaySweepScheduler();
  (await import("./jobs/documentSweepScheduler")).stopDocumentSweepScheduler();
  (await import("./jobs/photoJourneyScanScheduler")).stopPhotoJourneyScanScheduler();
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

    // Seed cruise catalog tables (ports + ships) — idempotent, skips on
    // already-seeded UNLOCODE/IMO matches and preserves isUserAdded rows.
    try {
      await seedPortsFromCSV();
      logger.info({ operation: "server_start_seed_ports", message: "Ports seeded" });
    } catch (error) {
      logger.warn({
        operation: "server_start_seed_ports_error",
        message: "Failed to seed ports from CSV",
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }

    try {
      await seedShipsFromCSV();
      logger.info({ operation: "server_start_seed_ships", message: "Ships seeded" });
    } catch (error) {
      logger.warn({
        operation: "server_start_seed_ships_error",
        message: "Failed to seed ships from CSV",
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      });
    }

    // Seed the lodging chain catalog — idempotent, preserves isUserAdded rows.
    try {
      await seedLodgingChainsFromCSV();
      logger.info({
        operation: "server_start_seed_lodging_chains",
        message: "Lodging chains seeded",
      });
    } catch (error) {
      logger.warn({
        operation: "server_start_seed_lodging_chains_error",
        message: "Failed to seed lodging chains from CSV",
        error: {
          message: error instanceof Error ? error.message : "Unknown error",
        },
      });
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

    // Backfill nextApiCheckAt for scheduled flights that don't have it set yet
    try {
      const { calculateNextApiCheckAt } = await import("./utils/smartCheckSchedule");
      const scheduledFlights = await prisma.flight.findMany({
        where: {
          status: "scheduled",
          flightNumber: { not: null },
          departureTime: { not: null },
          nextApiCheckAt: null,
        },
        select: {
          id: true,
          departureTime: true,
          arrivalTime: true,
          status: true,
          flightNumber: true,
        },
      });
      if (scheduledFlights.length > 0) {
        let updated = 0;
        let skipped = 0;
        for (const f of scheduledFlights) {
          const checkAt = calculateNextApiCheckAt(
            f.departureTime,
            f.arrivalTime,
            f.status,
            f.flightNumber
          );
          if (checkAt) {
            await prisma.flight.update({ where: { id: f.id }, data: { nextApiCheckAt: checkAt } });
            updated++;
          } else {
            // Past arrival + buffer, or otherwise ineligible — count separately so
            // the log doesn't claim we populated all candidates.
            skipped++;
          }
        }
        logger.info({
          operation: "server_start_backfill_api_check",
          message: `Backfilled nextApiCheckAt for ${updated} of ${scheduledFlights.length} scheduled flights (${skipped} ineligible)`,
          context: { candidates: scheduledFlights.length, updated, skipped },
        });
      }
    } catch (error) {
      logger.warn({
        operation: "server_start_backfill_api_check_error",
        message: "Failed to backfill nextApiCheckAt",
        error,
      });
    }

    // Airport zones: fill the missing ones, and once per instance re-derive
    // the ones geo-tz's old default folded together (CAMP-03).
    const { refreshAirportTimezonesOnStartup } = await import("./services/airportTimezoneRepair");
    await refreshAirportTimezonesOnStartup();

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
