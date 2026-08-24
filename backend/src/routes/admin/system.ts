import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { adminExportLimiter, adminReseedLimiter } from '../../middleware/rateLimit';
import { getInstanceSettings } from '../../services/instanceSettingsService';
import { startAirportSeeding, getSeedingStatus } from '../../services/airportSeedingService';
import { sweepStaleLogos } from '../../jobs/airlineLogoRefreshScheduler';
import logger from '../../utils/logger';
import { appVersion, buildVersion } from '../../utils/version';

const router = Router();

// In-memory status. Deliberately not a DB row: a sweep is cheap, idempotent and
// safe to lose across a restart — unlike the airport seed, which is not.
interface LogoRefreshStatus {
  running: boolean;
  checked: number | null;
  refreshed: number | null;
  finishedAt: string | null;
}
let logoRefreshStatus: LogoRefreshStatus = {
  running: false, checked: null, refreshed: null, finishedAt: null,
};

// Test-only seam: the "second sweep while one is running" test mocks
// sweepStaleLogos to never resolve, which would otherwise leave
// logoRefreshStatus.running = true for the rest of the suite.
export function __resetLogoRefreshStatusForTests(): void {
  logoRefreshStatus = { running: false, checked: null, refreshed: null, finishedAt: null };
}

// POST /admin/airline-logos/refresh — re-check every stored logo against the
// resolution chain now, instead of waiting for tonight's sweep. Returns at once;
// poll GET /admin/airline-logos/refresh-status.
router.post('/airline-logos/refresh', adminReseedLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (logoRefreshStatus.running) {
      res.status(409).json({ error: 'A logo refresh is already running' });
      return;
    }
    logoRefreshStatus = { running: true, checked: null, refreshed: null, finishedAt: null };
    logger.info({
      operation: 'admin_airline_logo_refresh',
      message: 'Airline logo refresh triggered via admin endpoint',
      context: { triggeredBy: req.userId, viaPAT: !!req.apiToken },
    });

    // Fire and forget — the sweep can take minutes on a warm cache.
    void sweepStaleLogos()
      .then((result) => {
        logoRefreshStatus = {
          running: false,
          checked: result.checked,
          refreshed: result.refreshed,
          finishedAt: new Date().toISOString(),
        };
      })
      .catch((error: unknown) => {
        logger.error({
          operation: 'admin_airline_logo_refresh_failed',
          message: 'Airline logo refresh failed',
          error: { message: error instanceof Error ? error.message : 'unknown error' },
        });
        logoRefreshStatus = {
          running: false, checked: null, refreshed: null,
          finishedAt: new Date().toISOString(),
        };
      });

    res.status(202).json({ message: 'Logo refresh started' });
  } catch (error) {
    next(error);
  }
});

router.get('/airline-logos/refresh-status', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(logoRefreshStatus);
  } catch (error) {
    next(error);
  }
});

// POST /admin/airports/reseed — force a re-run of the OurAirports importer
// against the existing DB. Idempotent for active airports (composite-key
// upsert) and adds missing closed airports (TXL/THF/SXF/etc) that were
// not seeded by the legacy OpenFlights script. Returns immediately with
// a status row id; use GET /admin/airports/seeding-status to poll.
router.post('/airports/reseed', adminReseedLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = await startAirportSeeding({ force: true });
    logger.info({
      operation: 'admin_airport_reseed',
      message: 'Airport re-seed triggered via admin endpoint',
      context: { statusId: id, triggeredBy: req.userId, viaPAT: !!req.apiToken },
    });
    res.status(202).json({ statusId: id, message: 'Seeding started' });
  } catch (error) {
    next(error);
  }
});

router.get('/airports/seeding-status', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const status = await getSeedingStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

// POST /admin/airlines/reseed — force a re-run of the OpenFlights airline
// importer against the existing DB. Idempotent (composite-key upsert on
// IATA); user-added rows are never overwritten. Runs synchronously and
// refreshes the in-memory airline catalog cache before responding.
router.post('/airlines/reseed', adminReseedLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { seedAirlinesFromData } = await import('../../seedAirlinesFromData');
    const { invalidateAirlineCatalogCache, preloadAirlineCatalog } = await import('../../services/airlineCatalogCache');
    const inserted = await seedAirlinesFromData();
    invalidateAirlineCatalogCache();
    await preloadAirlineCatalog();
    logger.info({ operation: 'admin_airline_reseed', context: { inserted, triggeredBy: req.userId } });
    res.json({ inserted });
  } catch (error) {
    next(error);
  }
});

// POST /admin/aircraft/reseed — force a re-run of the OpenFlights aircraft
// importer against the existing DB. Idempotent (unique ICAO); user-added
// rows are never overwritten. Runs synchronously and refreshes the
// in-memory aircraft catalog cache before responding.
router.post('/aircraft/reseed', adminReseedLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { seedAircraftFromData } = await import('../../seedAircraftFromData');
    const { invalidateAircraftCatalogCache, preloadAircraftCatalog } = await import('../../services/aircraftCatalogCache');
    const inserted = await seedAircraftFromData();
    invalidateAircraftCatalogCache();
    await preloadAircraftCatalog();
    logger.info({ operation: 'admin_aircraft_reseed', context: { inserted, triggeredBy: req.userId } });
    res.json({ inserted });
  } catch (error) {
    next(error);
  }
});

// Get system information
router.get('/system/info', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userCount = await prisma.user.count();
    const activeUserCount = await prisma.user.count({ where: { isActive: true } });
    const flightCount = await prisma.flight.count();
    const { instanceName, maxUsers, allowRegistration } = await getInstanceSettings();

    // Check for demo user
    const demoUser = await prisma.user.findUnique({
      where: { username: 'demo' },
      select: { id: true, isActive: true },
    });

  res.json({
    instanceName,
    userCount,
    activeUserCount,
    flightCount,
      maxUsers,
      warningThreshold: userCount >= maxUsers,
      registrationEnabled: allowRegistration,
      demoUserExists: !!demoUser,
      demoUserActive: demoUser?.isActive || false,
    version: appVersion,
    buildVersion,
  });
  } catch (error) {
    next(error);
  }
});

/**
 * Export every domain the instance holds, as JSON.
 *
 * This route used to select `flights`, achievements and settings only, while
 * calling itself "export all data" and downloading as `travstats-backup-…json`.
 * Cruises, lodging, trips, places, bookings and companions were all missing —
 * anyone who used it as a backup lost five domains without being told.
 *
 * It is NOT the restore path (that is a pg_dump, see `services/backup/`). It is
 * a human-readable dump someone downloads, so credential material is left out
 * on purpose: password hashes, reset/change/2FA tokens and secrets, WebAuthn
 * credentials, API tokens and pairing codes never appear. `UserSettings` is
 * selected field by field for the same reason — `settings: true` used to carry
 * every stored API key into the file. They are encrypted at rest, but a
 * downloadable file is not the place for them and nothing here needs them.
 */
router.get('/export/all-data', adminExportLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        isAdmin: true,
        isActive: true,
        invitedBy: true,
        createdAt: true,
        birthdate: true,
        notificationEmail: true,
        notifyBefore24h: true,
        notifyBefore2h: true,
        // Deliberately excluded: passwordHash, resetToken/changeToken and their
        // expiries, every twoFactor* column, webauthnCredentials,
        // twoFactorRecoveryCodes, apiTokens, pairingCodes.

        // Travel data — the point of the export.
        flights: true,
        cruises: { include: { stops: true, legs: true } },
        trips: { include: { stops: true, journalEntries: true, photos: true } },
        bookings: true,
        lodgings: true,
        lodgingStays: true,
        lodgingMemberships: true,
        places: true,
        placeVisits: { include: { photos: true } },
        placeLists: { include: { entries: true } },
        companions: true,
        userAchievements: {
          include: {
            achievement: true,
          },
        },
        // Field-by-field: the stored API keys are not part of a data export.
        settings: {
          select: {
            enabledDomains: true,
            baseCurrency: true,
            data: true,
            appPrefs: true,
            autoCreateTrips: true,
            preferredVisionParser: true,
            preferredTextParser: true,
            immichDefaultMode: true,
            autoUpdateEnabled: true,
            autoUpdateRequireApproval: true,
            historicalEnrichmentEnabled: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    const { instanceName } = await getInstanceSettings();
    const exportData = {
      exportedAt: new Date().toISOString(),
      instanceName,
      users,
    };

    const exportFilename = `travstats-backup-${Date.now()}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(exportFilename)}`);
    res.json(exportData);
  } catch (error) {
    next(error);
  }
});

export default router;
