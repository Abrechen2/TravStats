import { Router, Response, NextFunction } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { prisma } from '../db';
import { AppError } from '../middleware/errorHandler';
import crypto from 'crypto';
import { z } from 'zod';
import { getSystemSettings, updateEmailImportSettings } from '../services/systemSettings';

const router = Router();

// All routes require authentication and admin privileges
router.use(authenticate);
router.use(requireAdmin);

// Get system information
router.get('/system/info', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userCount = await prisma.user.count();
    const activeUserCount = await prisma.user.count({ where: { isActive: true } });
    const flightCount = await prisma.flight.count();
    const maxUsers = parseInt(process.env.MAX_USERS || '10');
    const allowRegistration = process.env.ALLOW_REGISTRATION !== 'false';

    // Check for demo user
    const demoUser = await prisma.user.findUnique({
      where: { username: 'demo' },
      select: { id: true, isActive: true },
    });

    const { emailImport } = await getSystemSettings();

    res.json({
      instanceName: process.env.INSTANCE_NAME || 'TravStats',
      userCount,
      activeUserCount,
      flightCount,
      maxUsers,
      warningThreshold: userCount >= maxUsers,
      registrationEnabled: allowRegistration,
      demoUserExists: !!demoUser,
      demoUserActive: demoUser?.isActive || false,
      version: '1.0.0',
      emailImport: {
        enabled: emailImport.enabled,
        imapEnabled: emailImport.imap.enabled,
      },
    });
  } catch (error) {
    next(error);
  }
});

const emailImportSchema = z.object({
  enabled: z.boolean().optional(),
  importSecret: z.string().optional(),
  allowUserConfiguration: z.boolean().optional(),
  imap: z
    .object({
      enabled: z.boolean().optional(),
      host: z.string().optional(),
      port: z.number().int().positive().optional(),
      secure: z.boolean().optional(),
      user: z.string().optional(),
      password: z.string().optional(),
      mailbox: z.string().optional(),
      allowedSenders: z.array(z.string()).optional(),
      subjectKeywords: z.array(z.string()).optional(),
      defaultUserId: z.string().optional(),
      pollIntervalMinutes: z.number().int().positive().optional(),
    })
    .optional(),
});

router.get('/system/email-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { emailImport } = await getSystemSettings();
    res.json({ emailImport });
  } catch (error) {
    next(error);
  }
});

router.put('/system/email-settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const payload = emailImportSchema.parse(req.body);
    const updated = await updateEmailImportSettings(payload);
    res.json({ emailImport: updated });
  } catch (error) {
    next(error);
  }
});

// Get all users
router.get('/users', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        isAdmin: true,
        isActive: true,
        invitedBy: true,
        createdAt: true,
        _count: {
          select: {
            flights: true,
            userAchievements: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ users });
  } catch (error) {
    next(error);
  }
});

// Toggle user active status
router.patch('/users/:id/toggle-active', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Prevent deactivating yourself
    if (id === req.userId) {
      throw new AppError('Cannot deactivate your own account', 400);
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { isActive: true },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive },
      select: {
        id: true,
        username: true,
        isAdmin: true,
        isActive: true,
      },
    });

    res.json({ user: updatedUser });
  } catch (error) {
    next(error);
  }
});

// Create invitation
router.post('/invitations', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { email, expiresInDays = 7 } = req.body;
    const token = crypto.randomBytes(32).toString('hex');

    const invitation = await prisma.invitation.create({
      data: {
        email,
        token,
        createdBy: req.userId!,
        expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
      },
    });

    // Generate invitation URL
    const frontendUrl = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || 'http://localhost:3000';
    const inviteUrl = `${frontendUrl}/register?token=${token}`;

    res.json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
      },
      inviteUrl,
    });
  } catch (error) {
    next(error);
  }
});

// List invitations
router.get('/invitations', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const invitations = await prisma.invitation.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        token: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
        creator: {
          select: {
            username: true,
          },
        },
      },
    });

    res.json({ invitations });
  } catch (error) {
    next(error);
  }
});

// Export all data (for backup)
router.get('/export/all-data', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        flights: true,
        userAchievements: {
          include: {
            achievement: true,
          },
        },
        settings: true,
      },
    });

    const exportData = {
      exportedAt: new Date().toISOString(),
      instanceName: process.env.INSTANCE_NAME || 'TravStats',
      users,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="travstats-backup-${Date.now()}.json"`);
    res.json(exportData);
  } catch (error) {
    next(error);
  }
});

export default router;
