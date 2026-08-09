import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import { hashPassword } from '../../utils/password';
import { adminCreateUserSchema, adminResetPasswordSchema } from '../../schemas/auth';
import { sendAdminPasswordResetEmail } from '../../services/emailService';
import { SMTP_CONFIG_ID } from './smtp';
import logger from '../../utils/logger';
import { getInstanceSettings } from '../../services/instanceSettingsService';

const router = Router();

// POST /users — admin creates a user directly (no invitation token required).
// Surface for AI-agent / onboarding flows: an admin-scope PAT can call this
// to provision test users or import-only accounts without the cookie/email
// invitation dance. The MAX_USERS instance limit is still enforced.
router.post('/users', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const payload = adminCreateUserSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { username: payload.username } });
    if (existing) throw new AppError('Username already exists', 400);

    const { maxUsers } = await getInstanceSettings();
    const userCount = await prisma.user.count();
    if (userCount >= maxUsers) throw new AppError('User limit reached', 409);

    const passwordHash = await hashPassword(payload.password);
    const created = await prisma.user.create({
      data: {
        username: payload.username,
        passwordHash,
        isAdmin: payload.isAdmin,
        notificationEmail: payload.notificationEmail,
        invitedBy: req.userId,
      },
      select: { id: true, username: true, isAdmin: true, isActive: true, createdAt: true },
    });

    logger.info({
      operation: 'admin_user_create',
      message: 'Admin created user via /admin/users',
      context: { createdUserId: created.id, createdBy: req.userId, viaPAT: !!req.apiToken },
    });

    res.status(201).json({ user: created });
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

// DELETE /users/:id — permanently remove a user and all related data
// (admin only — protected by requireAdmin in admin/index.ts).
// Guards: cannot delete yourself; cannot remove the last remaining admin.
// Cascade: flights, trips, bookings, user_settings, achievements,
// pending_flight_updates, parser_templates, etc. are all removed via
// Prisma onDelete: Cascade on their User foreign key.
router.delete('/users/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    if (id === req.userId) {
      throw new AppError('Cannot delete your own account', 400);
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, isAdmin: true },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (user.isAdmin) {
      const adminCount = await prisma.user.count({ where: { isAdmin: true } });
      if (adminCount <= 1) {
        throw new AppError('Cannot delete the last remaining admin', 400);
      }
    }

    await prisma.user.delete({ where: { id } });

    logger.info({
      operation: 'admin_delete_user',
      adminId: req.userId,
      targetUserId: id,
      targetUsername: user.username,
    });

    res.json({ message: 'User deleted', userId: id });
  } catch (error) {
    next(error);
  }
});

// POST /users/:id/reset-password (admin only — protected by requireAdmin in admin/index.ts)
router.post(
  '/users/:id/reset-password',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { mode, password, mustChangePassword } = adminResetPasswordSchema.parse(req.body);

      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, username: true, notificationEmail: true },
      });
      if (!user) {
        throw new AppError('User not found', 404);
      }

      let plainPassword: string | undefined;
      let newPasswordHash: string;

      if (mode === 'generate') {
        const chars =
          'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
        const randomBytes = crypto.randomBytes(12);
        plainPassword = Array.from(
          randomBytes,
          (byte) => chars[byte % chars.length],
        ).join('');
        newPasswordHash = await hashPassword(plainPassword);
      } else {
        if (!password) {
          throw new AppError('Password is required for mode "set"', 400);
        }
        newPasswordHash = await hashPassword(password);
      }

      const shouldMustChange = mustChangePassword ?? mode === 'generate';

      await prisma.user.update({
        where: { id },
        data: {
          passwordHash: newPasswordHash,
          mustChangePassword: shouldMustChange,
          resetToken: null,
          resetTokenExpiry: null,
          changeToken: null,
          changeTokenExpiry: null,
        },
      });

      logger.info({
        operation: 'admin_password_reset',
        adminId: req.userId,
        targetUserId: id,
        mode,
      });

      // Pentest H4: if the generated password can be delivered via email,
      // do not return it in the response body. Fall back to returning it
      // only when SMTP is unavailable or the user has no notification email.
      let emailDelivered = false;
      if (plainPassword !== undefined && user.notificationEmail) {
        const smtpConfig = await prisma.smtpConfig.findUnique({
          where: { id: SMTP_CONFIG_ID },
          select: { enabled: true },
        });
        if (smtpConfig?.enabled) {
          try {
            await sendAdminPasswordResetEmail(
              user.notificationEmail,
              user.username,
              plainPassword,
            );
            emailDelivered = true;
          } catch (error) {
            logger.warn({
              operation: 'admin_password_reset_email_failed',
              adminId: req.userId,
              targetUserId: id,
              error: {
                message: error instanceof Error ? error.message : 'Unknown error',
              },
            });
          }
        }
      }

      res.json({
        message: emailDelivered
          ? 'Password reset — temporary password emailed to user'
          : 'Password reset successfully',
        emailDelivered,
        // Only surface the plaintext password if it could not be delivered by email
        // (no notification email on file, or SMTP disabled / send failed).
        ...(plainPassword !== undefined && !emailDelivered && { temporaryPassword: plainPassword }),
      });
    } catch (error) {
      next(error);
    }
  },
);

// POST /users/:id/disable-2fa — the way back in for a user who lost their phone
// AND their recovery codes, without anyone needing a shell. Logged, because an
// admin switching off someone else's protection should leave a trace.
router.post(
  '/users/:id/disable-2fa',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const user = await prisma.user.findUnique({
        where: { id },
        select: { id: true, username: true },
      });
      if (!user) throw new AppError('User not found', 404);

      await prisma.$transaction([
        prisma.user.update({
          where: { id },
          data: {
            twoFactorSecret: null,
            twoFactorPendingSecret: null,
            twoFactorEnabledAt: null,
            twoFactorToken: null,
            twoFactorTokenExpiry: null,
          },
        }),
        prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: id } }),
      ]);

      logger.warn({
        operation: 'admin_two_factor_disabled',
        adminId: req.userId,
        targetUserId: id,
        targetUsername: user.username,
      });
      res.json({ disabled: true });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
