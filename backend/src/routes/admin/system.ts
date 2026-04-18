import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { adminExportLimiter } from '../../middleware/rateLimit';
import { getInstanceSettings } from '../../services/instanceSettingsService';

const router = Router();

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
