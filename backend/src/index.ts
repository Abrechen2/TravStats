import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth';
import flightRoutes from './routes/flights';
import flightLookupRoutes from './routes/flightLookup';
import statsRoutes from './routes/stats';
import airportRoutes from './routes/airports';
import airlineLogoRoutes from './routes/airlineLogos';
import achievementRoutes from './routes/achievements';
import settingsRoutes from './routes/settings';
import analyticsRoutes from './routes/analytics';
import uploadsRoutes from './routes/uploads';
import emailParseRoutes from './routes/emailParse';
import boardingpassParseRoutes from './routes/boardingpassParse';
import boardingpassMatchRoutes from './routes/boardingpassMatch';
import pdfParseRoutes from './routes/pdfParse';
import diagnosticExportRoutes from './routes/diagnosticExport';
import diagnosticsRoutes from './routes/diagnostics';
import setupRoutes from './routes/setup';
import adminRoutes from './routes/admin';
import backupRoutes from './routes/backup';
import pendingUpdatesRoutes from './routes/pendingUpdates';
import templateStatusRoutes from './routes/templateStatus';
import parserTemplatesRoutes from './routes/parserTemplates';
import trainingRoutes from './routes/training';
import tripsRoutes from './routes/trips';
import immichTripRoutes from './routes/immich/tripAlbums';
import immichAssetProxyRoutes from './routes/immich/assetProxy';
import immichTripCoverRoutes from './routes/immich/tripCover';
import passwordResetRoutes from './routes/passwordReset';
import suggestionsRoutes from './routes/suggestions';
import portsRoutes from './routes/ports';
import shipsRoutes from './routes/ships';
import airlinesRoutes from './routes/airlines';
import aircraftRoutes from './routes/aircraft';
import cruisesRouter from './routes/cruises';
import lodgingRouter from './routes/lodging';
import lodgingChainsRouter from './routes/lodgingChains';
import lodgingMembershipsRouter from './routes/lodgingMemberships';
import lodgingImportRoutes from './routes/lodgingImport';
import companionRoutes from './routes/companions';
import openapiRoutes from './routes/openapi';
import importRoutes from './routes/import';
import pairingRoutes from './routes/pairing';
import appSettingsRoutes from './routes/appSettings';
import geoRoutes from './routes/geo';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { prisma } from './db';
import logger from './utils/logger';
import { DATABASE_URL } from './utils/database';
import { appVersion, buildVersion } from './utils/version';
import { templateRegistry } from './services/parsers/templates/registry';
import { seedPortsFromCSV } from './seedPortsFromCSV';
import { seedShipsFromCSV } from './seedShipsFromCSV';
import { seedLodgingChainsFromCSV } from './seedLodgingChainsFromCSV';
import { seedAirlinesFromData } from './seedAirlinesFromData';
import { seedAircraftFromData } from './seedAircraftFromData';

// Load environment variables
dotenv.config();

// Validate environment variables
import { validateEnv } from './config/env';
try {
  validateEnv();
} catch (error) {
  logger.error({
    operation: 'server_start_env_validation_failed',
    message: 'Failed to start server due to environment variable validation errors',
    error: {
      message: error instanceof Error ? error.message : 'Unknown error',
    },
  });
  process.exit(1);
}

// Set DATABASE_URL from individual components if not already set
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = DATABASE_URL;
}

const app = express();
const PORT = parseInt(process.env.PORT || '8000', 10);

// Trust proxy - we're behind exactly 1 proxy (nginx)
app.set('trust proxy', 1);

// Security middleware with CSP configuration
app.use(helmet({
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
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null, // Upgrade HTTP to HTTPS in production
    },
  },
  crossOriginEmbedderPolicy: false, // Disable COEP to allow external resources if needed
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin resources
}));

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
  (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : undefined);

if (corsOrigin) {
  const allowedOrigins =
    corsOrigin === '*' ? [] : corsOrigin.split(',').map((o) => o.trim()).filter(Boolean);
  const allowAllOrigins = corsOrigin === '*';

  app.use(
    cors({
      origin: (origin, callback) => {
        if (allowAllOrigins) return callback(null, true);
        // Allow requests without origin (mobile apps, server-to-server, etc.)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }),
  );
} else {
  logger.info({
    operation: 'cors_disabled',
    message: 'CORS disabled (production same-origin default). Set CORS_ORIGIN to enable cross-origin access.',
  });
}

import { RATE_LIMITS, FILE_LIMITS } from './config/constants';

// Rate limiting.
// Skips requests originating from the loopback, Docker-bridge and RFC 1918
// private ranges — self-hosted LAN deployments (Unraid, home-lab compose
// stacks) behave the same as dev and don't get throttled. Public-facing
// deployments still enforce the cap.
const LAN_IP_RE = /^(?:::1|::ffff:)?(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const limiter = rateLimit({
  windowMs: RATE_LIMITS.GENERAL_WINDOW_MS,
  max: process.env.NODE_ENV === 'production' ? RATE_LIMITS.GENERAL_MAX_REQUESTS : RATE_LIMITS.GENERAL_MAX_REQUESTS_DEV,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => LAN_IP_RE.test(req.ip ?? ''),
});
app.use('/api/', limiter);

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

// Health check — mounted at both `/health` (legacy, used by the Dockerfile
// HEALTHCHECK and the nginx upstream probe) and `/api/v1/health` (versioned,
// matches the public-API URL convention documented for external callers).
const healthHandler = (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: appVersion });
};
app.get('/health', healthHandler);
app.get('/api/v1/health', healthHandler);

// Public version endpoint — unauthenticated so the About section can
// show the right version even before login. Returns both the runtime
// version (what the user sees) and the build version baked into the
// image (kept for diagnostics, only shown when it differs). Also
// surfaces the latest stable GitHub release so the UI can show an
// update banner. Network failures degrade to latestAvailable=null so
// air-gapped installs simply hide the banner.
app.get('/api/v1/version', async (_req, res) => {
  const { getCachedLatestRelease, isUpdateAvailable } = await import('./services/updateChecker');
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
app.get('/api/v1/parser-capabilities', async (_req, res, next) => {
  try {
    const { prisma } = await import('./db');
    const adminSettings = await prisma.adminSettings.findFirst({
      select: { ollamaUrl: true, ollamaModel: true },
    });
    const hasLlm = Boolean(adminSettings?.ollamaUrl && adminSettings?.ollamaModel);
    res.json({ hasLlm });
  } catch (error) {
    next(error);
  }
});

// API routes
// OpenAPI spec + Swagger UI mounted FIRST so /api/v1/docs and
// /api/v1/openapi.json don't fall through into authenticated routers.
app.use('/api/v1', openapiRoutes);
app.use('/api/v1/setup', setupRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/auth', passwordResetRoutes);
app.use('/api/v1/flights', flightRoutes);
app.use('/api/v1/flight-lookup', flightLookupRoutes);
app.use('/api/v1/stats', statsRoutes);
app.use('/api/v1/airports', airportRoutes);
app.use('/api/v1/airline-logos', airlineLogoRoutes);
app.use('/api/v1/achievements', achievementRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/uploads', uploadsRoutes);
app.use('/api/v1', emailParseRoutes);
app.use('/api/v1', boardingpassParseRoutes);
app.use('/api/v1/boardingpass', boardingpassMatchRoutes);
app.use('/api/v1', pdfParseRoutes);
app.use('/api/v1', diagnosticExportRoutes);
app.use('/api/v1', diagnosticsRoutes);
app.use('/api/v1/parser-templates', parserTemplatesRoutes);
app.use('/api/v1/backup', backupRoutes);
app.use('/api/v1/pending-updates', pendingUpdatesRoutes);
app.use('/api/v1/template-status', templateStatusRoutes);
app.use('/api/v1/training', trainingRoutes);
app.use('/api/v1', tripsRoutes);
app.use('/api/v1', immichTripRoutes);
app.use('/api/v1', immichAssetProxyRoutes);
app.use('/api/v1', immichTripCoverRoutes);
app.use('/api/v1/suggestions', suggestionsRoutes);
app.use('/api/v1/ports', portsRoutes);
app.use('/api/v1/ships', shipsRoutes);
app.use('/api/v1/airlines', airlinesRoutes);
app.use('/api/v1/aircraft', aircraftRoutes);
app.use('/api/v1/cruises', cruisesRouter);
app.use('/api/v1/lodging', lodgingRouter);
app.use('/api/v1/lodging-chains', lodgingChainsRouter);
app.use('/api/v1/lodging-memberships', lodgingMembershipsRouter);
app.use('/api/v1/lodging-import', lodgingImportRoutes);
app.use('/api/v1/companions', companionRoutes);
app.use('/api/v1/import', importRoutes);
app.use('/api/v1/pairing', pairingRoutes);
app.use('/api/v1/app-settings', appSettingsRoutes);
app.use('/api/v1/geo', geoRoutes);

// 404 handler for unmatched routes (must be before errorHandler)
app.use(notFoundHandler);

// Error handling
app.use(errorHandler);

// Global error handlers — prevent silent crashes from async scheduler errors
process.on('unhandledRejection', (reason: unknown) => {
  logger.error({
    operation: 'unhandled_rejection',
    message: 'Unhandled promise rejection',
    error: {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    },
  });
});

process.on('uncaughtException', (error: Error) => {
  logger.error({
    operation: 'uncaught_exception',
    message: 'Uncaught exception — process will exit',
    error: {
      message: error.message,
      stack: error.stack,
    },
  });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  const { stopScheduler } = await import('./services/backupScheduler');
  stopScheduler();
  const { stopHistoricalEnrichmentScheduler } = await import('./jobs/historicalEnrichmentScheduler');
  stopHistoricalEnrichmentScheduler();
  const { stopReminderScheduler } = await import('./services/reminderScheduler');
  stopReminderScheduler();
  const { stopUsageStatsScheduler } = await import('./jobs/usageStatsScheduler');
  stopUsageStatsScheduler();
  const { stopAirlineLogoRefreshScheduler } = await import('./jobs/airlineLogoRefreshScheduler');
  stopAirlineLogoRefreshScheduler();
  const { stopStatusSweepScheduler } = await import('./jobs/statusSweepScheduler');
  stopStatusSweepScheduler();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  const { stopScheduler } = await import('./services/backupScheduler');
  stopScheduler();
  const { stopHistoricalEnrichmentScheduler } = await import('./jobs/historicalEnrichmentScheduler');
  stopHistoricalEnrichmentScheduler();
  const { stopReminderScheduler } = await import('./services/reminderScheduler');
  stopReminderScheduler();
  const { stopUsageStatsScheduler } = await import('./jobs/usageStatsScheduler');
  stopUsageStatsScheduler();
  const { stopAirlineLogoRefreshScheduler } = await import('./jobs/airlineLogoRefreshScheduler');
  stopAirlineLogoRefreshScheduler();
  const { stopStatusSweepScheduler } = await import('./jobs/statusSweepScheduler');
  stopStatusSweepScheduler();
  await prisma.$disconnect();
  process.exit(0);
});

// Start server only if not in test mode
if (process.env.NODE_ENV !== 'test') {
  const HOST = process.env.HOST || '0.0.0.0'; // Bind to all interfaces for network access
  app.listen(PORT, HOST, async () => {
    logger.info({
      message: 'TravStats backend started',
      host: HOST,
      port: PORT,
      environment: process.env.NODE_ENV,
      nodeVersion: process.version,
    });

    // Ensure achievement definitions are present (idempotent upsert)
    try {
      const { ensureAchievements } = await import('./data/achievements');
      await ensureAchievements();
      logger.info({ operation: 'server_start_achievements', message: 'Achievements ensured' });
    } catch (error) {
      logger.error({ operation: 'server_start_achievements_error', message: 'Failed to ensure achievements', error });
    }

    // Seed cruise catalog tables (ports + ships) — idempotent, skips on
    // already-seeded UNLOCODE/IMO matches and preserves isUserAdded rows.
    try {
      await seedPortsFromCSV();
      logger.info({ operation: 'server_start_seed_ports', message: 'Ports seeded' });
    } catch (error) {
      logger.warn({
        operation: 'server_start_seed_ports_error',
        message: 'Failed to seed ports from CSV',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    try {
      await seedShipsFromCSV();
      logger.info({ operation: 'server_start_seed_ships', message: 'Ships seeded' });
    } catch (error) {
      logger.warn({
        operation: 'server_start_seed_ships_error',
        message: 'Failed to seed ships from CSV',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // Seed the lodging chain catalog — idempotent, preserves isUserAdded rows.
    try {
      await seedLodgingChainsFromCSV();
      logger.info({ operation: 'server_start_seed_lodging_chains', message: 'Lodging chains seeded' });
    } catch (error) {
      logger.warn({
        operation: 'server_start_seed_lodging_chains_error',
        message: 'Failed to seed lodging chains from CSV',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    try {
      await seedAirlinesFromData();
      logger.info({ operation: 'server_start_seed_airlines', message: 'Airlines seeded' });
    } catch (error) {
      logger.warn({
        operation: 'server_start_seed_airlines_error',
        message: 'Failed to seed airlines',
        error: { message: error instanceof Error ? error.message : 'Unknown error' },
      });
    }

    try {
      await seedAircraftFromData();
      logger.info({ operation: 'server_start_seed_aircraft', message: 'Aircraft seeded' });
    } catch (error) {
      logger.warn({
        operation: 'server_start_seed_aircraft_error',
        message: 'Failed to seed aircraft',
        error: { message: error instanceof Error ? error.message : 'Unknown error' },
      });
    }

    try {
      const { preloadAirlineCatalog } = await import("./services/airlineCatalogCache");
      const { preloadAircraftCatalog } = await import("./services/aircraftCatalogCache");
      await preloadAirlineCatalog();
      await preloadAircraftCatalog();
      logger.info({ operation: 'server_start_catalog_preload', message: 'Airline+aircraft caches preloaded' });
    } catch (error) {
      logger.warn({ operation: 'server_start_catalog_preload_error', message: 'Failed to preload catalogues', error });
    }

    try {
      const { backfillAirlineCodes } = await import("./scripts/backfillAirlineCodes");
      const n = await backfillAirlineCodes();
      if (n > 0) logger.info({ operation: 'server_start_backfill_airline_codes', message: `Backfilled ${n} flights` });
    } catch (error) {
      logger.warn({ operation: 'server_start_backfill_airline_codes_error', message: 'Failed to backfill airline codes', error });
    }

    // Normalise stored aircraft types to the catalogue's canonical names
    // (idempotent). normalizeAircraft only ever ran on the write path, so
    // older libraries mix "Airbus A350-900", "B737-800" and "A320neo" in one
    // column. Unrecognised types are left untouched.
    try {
      const { backfillAircraftNames } = await import("./scripts/backfillAircraftNames");
      const n = await backfillAircraftNames();
      if (n > 0) logger.info({ operation: 'server_start_backfill_aircraft_names', message: `Normalised ${n} flights` });
    } catch (error) {
      logger.warn({ operation: 'server_start_backfill_aircraft_names_error', message: 'Failed to normalise aircraft names', error });
    }

    // Backfill booking-level prices (idempotent — heals bookings created
    // priceless by pre-2.5 imports; spec 2026-07-17-cost-booking-price)
    try {
      const { backfillBookingPrices } = await import("./scripts/backfillBookingPrices");
      const healed = await backfillBookingPrices();
      if (healed > 0) {
        logger.info({ operation: "server_start_backfill_booking_prices", message: `Healed ${healed} bookings` });
      }
    } catch (error) {
      logger.warn({ operation: "server_start_backfill_booking_prices_error", message: "Failed to backfill booking prices", error });
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

    // Normalize aircraft type names in existing flights (idempotent)
    try {
      const { normalizeAircraft } = await import('./utils/aircraftNormalize');
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
        logger.info({ operation: 'server_start_aircraft_normalize', message: `Normalized ${aircraftUpdated} aircraft type names` });
      }
    } catch (error) {
      logger.warn({ operation: 'server_start_aircraft_normalize_error', message: 'Failed to normalize aircraft names', error });
    }

    // Backfill nextApiCheckAt for scheduled flights that don't have it set yet
    try {
      const { calculateNextApiCheckAt } = await import('./utils/smartCheckSchedule');
      const scheduledFlights = await prisma.flight.findMany({
        where: {
          status: 'scheduled',
          flightNumber: { not: null },
          departureTime: { not: null },
          nextApiCheckAt: null,
        },
        select: { id: true, departureTime: true, arrivalTime: true, status: true, flightNumber: true },
      });
      if (scheduledFlights.length > 0) {
        let updated = 0;
        let skipped = 0;
        for (const f of scheduledFlights) {
          const checkAt = calculateNextApiCheckAt(f.departureTime, f.arrivalTime, f.status, f.flightNumber);
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
          operation: 'server_start_backfill_api_check',
          message: `Backfilled nextApiCheckAt for ${updated} of ${scheduledFlights.length} scheduled flights (${skipped} ineligible)`,
          context: { candidates: scheduledFlights.length, updated, skipped },
        });
      }
    } catch (error) {
      logger.warn({ operation: 'server_start_backfill_api_check_error', message: 'Failed to backfill nextApiCheckAt', error });
    }

    // Backfill airport timezones from coordinates (idempotent, skips airports that already have timezone)
    try {
      const { backfillAirportTimezones } = await import('./services/airportLookup');
      const updated = await backfillAirportTimezones();
      if (updated > 0) {
        const { clearAirportCache } = await import('./services/airportCache');
        clearAirportCache();
        logger.info({ operation: 'server_start_timezone_backfill', message: `Backfilled timezone for ${updated} airports` });
      }
    } catch (error) {
      logger.warn({ operation: 'server_start_timezone_backfill_error', message: 'Failed to backfill airport timezones', error });
    }

    // Converge stored temporal statuses with the dates on boot (idempotent —
    // same logic as the hourly sweep, see services/statusSweep.ts).
    try {
      const { sweepStatuses } = await import('./services/statusSweep');
      const counts = await sweepStatuses();
      logger.info({ operation: 'server_start_status_sweep', context: counts });
    } catch (error) {
      logger.warn({ operation: 'server_start_status_sweep_error', message: 'Failed to run boot status sweep', error });
    }

    // Re-evaluate achievements for every user. The engine only runs on a flight/cruise
    // write, so a user who adds nothing would keep a badge that a scoring fix has since
    // invalidated (the continent mapping used to call the Arctic "Antarctica" and count a
    // phantom "Middle East" continent). Idempotent: writes nothing when nothing changed.
    try {
      const { recheckAllAchievements } = await import('./scripts/recheckAchievements');
      const { users, failed } = await recheckAllAchievements();
      logger.info({
        operation: 'server_start_achievement_recheck',
        message: `Re-evaluated achievements for ${users - failed} of ${users} users`,
        context: { users, failed },
      });
    } catch (error) {
      logger.warn({
        operation: 'server_start_achievement_recheck_error',
        message: 'Failed to re-evaluate achievements',
        error,
      });
    }

    // Initialize backup scheduler
    try {
      const { startScheduler } = await import('./services/backupScheduler');
      await startScheduler();
    } catch (error) {
      logger.warn({
        operation: 'server_start_backup_scheduler_error',
        message: 'Failed to start backup scheduler',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // Start flight update scheduler
    try {
      const { startFlightUpdateScheduler } = await import('./jobs/flightUpdateScheduler');
      // Sweep every 5 minutes — nextApiCheckAt on each flight controls actual timing
      startFlightUpdateScheduler(5);
      logger.info({
        operation: 'server_start_flight_update_scheduler',
        message: 'Flight update scheduler started',
      });
    } catch (error) {
      logger.warn({
        operation: 'server_start_flight_update_scheduler_error',
        message: 'Failed to start flight update scheduler',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // Start historical enrichment scheduler
    try {
      const { startHistoricalEnrichmentScheduler } = await import('./jobs/historicalEnrichmentScheduler');
      startHistoricalEnrichmentScheduler();
      logger.info({
        operation: 'server_start_historical_enrichment_scheduler',
        message: 'Historical enrichment scheduler started',
      });
    } catch (error) {
      logger.warn({
        operation: 'server_start_historical_enrichment_scheduler_error',
        message: 'Failed to start historical enrichment scheduler',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // Start airline logo refresh scheduler
    try {
      const { startAirlineLogoRefreshScheduler } = await import('./jobs/airlineLogoRefreshScheduler');
      startAirlineLogoRefreshScheduler();
      logger.info({
        operation: 'server_start_airline_logo_refresh_scheduler',
        message: 'Airline logo refresh scheduler started',
      });
    } catch (error) {
      logger.warn({
        operation: 'server_start_airline_logo_refresh_scheduler_error',
        message: 'Failed to start airline logo refresh scheduler',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // Start hourly status sweep scheduler
    try {
      const { startStatusSweepScheduler } = await import('./jobs/statusSweepScheduler');
      startStatusSweepScheduler();
      logger.info({
        operation: 'server_start_status_sweep_scheduler',
        message: 'Status sweep scheduler started',
      });
    } catch (error) {
      logger.warn({
        operation: 'server_start_status_sweep_scheduler_error',
        message: 'Failed to start status sweep scheduler',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // Start flight reminder scheduler
    try {
      const { startReminderScheduler } = await import('./services/reminderScheduler');
      startReminderScheduler();
      logger.info({
        operation: 'server_start_reminder_scheduler',
        message: 'Flight reminder scheduler started',
      });
    } catch (error) {
      logger.warn({
        operation: 'server_start_reminder_scheduler_error',
        message: 'Failed to start flight reminder scheduler',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // Start usage-stats scheduler (jittered daily ping — no-op unless the
    // admin has granted consent and TRAVSTATS_STATS_ENDPOINT is configured)
    try {
      const { startUsageStatsScheduler } = await import('./jobs/usageStatsScheduler');
      startUsageStatsScheduler();
    } catch (error) {
      logger.error({ error }, 'server_start_usage_stats_scheduler_error');
    }

    // Initialize airline template registry
    try {
      await templateRegistry.initialize();
      logger.info({
        operation: 'server_start_template_registry',
        message: 'Airline template registry initialized',
      });
    } catch (error) {
      logger.warn({
        operation: 'server_start_template_registry_error',
        message: 'Failed to initialize airline template registry',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  });
}

export { app };
export default app;
