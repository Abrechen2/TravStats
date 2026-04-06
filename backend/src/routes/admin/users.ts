import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import crypto from 'crypto';
import { hashPassword } from '../../utils/password';
import { adminResetPasswordSchema } from '../../schemas/auth';
import logger from '../../utils/logger';

const router = Router();

const createInvitationSchema = z.object({
  email: z.string().email('Invalid email address').optional(),
  expiresInDays: z.number().int().min(1).max(90).optional().default(7),
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
        canTrainLLM: true,
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
    const { email, expiresInDays } = createInvitationSchema.parse(req.body);
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

// POST /users/:id/reset-password (admin only — protected by requireAdmin in admin/index.ts)
router.post(
  '/users/:id/reset-password',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { mode, password, mustChangePassword } = adminResetPasswordSchema.parse(req.body);

      const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
      if (!user) {
        throw new AppError('User not found', 404);
      }

      let plainPassword: string | undefined;
      let newPasswordHash: string;

      if (mode === 'generate') {
        const chars =
          'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
        plainPassword = Array.from(
          { length: 12 },
          () => chars[Math.floor(Math.random() * chars.length)],
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

      res.json({
        message: 'Password reset successfully',
        ...(plainPassword !== undefined && { temporaryPassword: plainPassword }),
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
