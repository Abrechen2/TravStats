import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import { hashPassword } from '../../utils/password';
import { adminResetPasswordSchema } from '../../schemas/auth';
import logger from '../../utils/logger';

const router = Router();

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
