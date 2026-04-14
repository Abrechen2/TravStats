import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth';
import flightRoutes from './routes/flights';
import flightLookupRoutes from './routes/flightLookup';
import statsRoutes from './routes/stats';
import airportRoutes from './routes/airports';
import achievementRoutes from './routes/achievements';
import settingsRoutes from './routes/settings';
import analyticsRoutes from './routes/analytics';
import uploadsRoutes from './routes/uploads';
import emailParseRoutes from './routes/emailParse';
import boardingpassParseRoutes from './routes/boardingpassParse';
import pdfParseRoutes from './routes/pdfParse';
import parserFeedbackRoutes from './routes/parserFeedback';
import setupRoutes from './routes/setup';
import adminRoutes from './routes/admin';
import backupRoutes from './routes/backup';
import pendingUpdatesRoutes from './routes/pendingUpdates';
import templateStatusRoutes from './routes/templateStatus';
import parserTemplatesRoutes from './routes/parserTemplates';
import trainingRoutes from './routes/training';
import tripsRoutes from './routes/trips';
import passwordResetRoutes from './routes/passwordReset';
import suggestionsRoutes from './routes/suggestions';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestLoggerMiddleware } from './middleware/requestLogger';
import { prisma } from './db';
import logger from './utils/logger';
import { DATABASE_URL } from './utils/database';
import { templateRegistry } from './services/parsers/templates/registry';

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

// Rate limiting
const limiter = rateLimit({
  windowMs: RATE_LIMITS.GENERAL_WINDOW_MS,
  max: process.env.NODE_ENV === 'production' ? RATE_LIMITS.GENERAL_MAX_REQUESTS : RATE_LIMITS.GENERAL_MAX_REQUESTS_DEV,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Body parsing with increased limits for email imports
app.use(express.json({ limit: FILE_LIMITS.JSON_BODY_MAX_SIZE }));
app.use(express.urlencoded({ extended: true, limit: FILE_LIMITS.URLENCODED_BODY_MAX_SIZE }));

// Cookie parsing (for HttpOnly JWT cookies)
app.use(cookieParser());

// Request logging middleware (with correlation IDs)
app.use(requestLoggerMiddleware);

// Read version from VERSION file (single source of truth)
// Read version from VERSION file and expose as env var for admin endpoints
try {
  const versionFile = path.join(__dirname, '../VERSION');
  if (fs.existsSync(versionFile)) {
    process.env.APP_VERSION = fs.readFileSync(versionFile, 'utf-8').trim();
  }
} catch {
  // fallback — APP_VERSION stays unset
}

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/v1/setup', setupRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/auth', passwordResetRoutes);
app.use('/api/v1/flights', flightRoutes);
app.use('/api/v1/flight-lookup', flightLookupRoutes);
app.use('/api/v1/stats', statsRoutes);
app.use('/api/v1/airports', airportRoutes);
app.use('/api/v1/achievements', achievementRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/uploads', uploadsRoutes);
app.use('/api/v1', emailParseRoutes);
app.use('/api/v1', boardingpassParseRoutes);
app.use('/api/v1', pdfParseRoutes);
app.use('/api/v1/parser-feedback', parserFeedbackRoutes);
app.use('/api/v1/parser-templates', parserTemplatesRoutes);
app.use('/api/v1/backup', backupRoutes);
app.use('/api/v1/pending-updates', pendingUpdatesRoutes);
app.use('/api/v1/template-status', templateStatusRoutes);
app.use('/api/v1/training', trainingRoutes);
app.use('/api/v1', tripsRoutes);
app.use('/api/v1/suggestions', suggestionsRoutes);

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
