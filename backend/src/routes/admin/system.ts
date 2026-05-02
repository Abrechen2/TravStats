import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { adminExportLimiter, adminReseedLimiter } from '../../middleware/rateLimit';
import { getInstanceSettings } from '../../services/instanceSettingsService';
import { startAirportSeeding, getSeedingStatus } from '../../services/airportSeedingService';
import logger from '../../utils/logger';

const router = Router();

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
    version: process.env.APP_VERSION || 'unknown',
    buildVersion: process.env.BUILD_VERSION || process.env.APP_VERSION || 'unknown',
  });
  } catch (error) {
    next(error);
  }
});

// Export all data (for backup)
router.get('/export/all-data', adminExportLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        isAdmin: true,
        isActive: true,
        invitedBy: true,
        createdAt: true,
        notificationEmail: true,
        notifyBefore24h: true,
        notifyBefore2h: true,
        // Deliberately excluded: passwordHash, resetToken, changeToken, resetTokenExpiry, changeTokenExpiry, mustChangePassword
        flights: true,
        userAchievements: {
          include: {
            achievement: true,
          },
        },
        settings: true,
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
