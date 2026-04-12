import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../db';
import { hashPassword } from '../utils/password';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  forceChangePasswordSchema,
} from '../schemas/auth';
import { passwordResetLimiter } from '../middleware/rateLimit';
import { AppError } from '../middleware/errorHandler';
import { SMTP_CONFIG_ID } from './admin/smtp';
import { sendPasswordResetEmail } from '../services/emailService';
import logger from '../utils/logger';

const router = Router();

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// GET /smtp-status — public, no auth
router.get('/smtp-status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
    res.json({ smtpEnabled: !!(config?.enabled) });
  } catch (error) {
    next(error);
  }
});

// POST /forgot-password — always 200 to prevent user enumeration
router.post(
  '/forgot-password',
  passwordResetLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username } = forgotPasswordSchema.parse(req.body);

      const user = await prisma.user.findUnique({ where: { username } });

      if (user && user.isActive && user.notificationEmail) {
        const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });

        if (config?.enabled) {
          const plainToken = crypto.randomBytes(32).toString('hex');
          const hashedToken = hashToken(plainToken);
          const expiry = new Date(Date.now() + 30 * 60 * 1000); // 30 min

          await prisma.user.update({
            where: { id: user.id },
            data: { resetToken: hashedToken, resetTokenExpiry: expiry },
          });

          const frontendUrl =
            process.env.FRONTEND_URL ||
            process.env.CORS_ORIGIN ||
            'http://localhost:3000';
          const resetUrl = `${frontendUrl}/reset-password?token=${plainToken}`;

          try {
            await sendPasswordResetEmail(user.notificationEmail, resetUrl, user.username);
          } catch (emailError) {
            logger.error({
              operation: 'forgot_password_email_failed',
              error: {
                message: emailError instanceof Error ? emailError.message : 'Unknown error',
              },
            });
            // Don't fail the request — return 200 regardless
          }
        }
      }

      res.json({
        message:
          'If the username exists and has an email configured, a reset link has been sent.',
      });
    } catch (error) {
      next(error);
    }
  },
);

// POST /reset-password
router.post(
  '/reset-password',
  passwordResetLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, newPassword } = resetPasswordSchema.parse(req.body);
      const hashedToken = hashToken(token);

      const user = await prisma.user.findFirst({
        where: {
          resetToken: hashedToken,
          resetTokenExpiry: { gt: new Date() },
        },
      });

      if (!user) {
        throw new AppError('Invalid or expired reset token', 400);
      }

      const newHash = await hashPassword(newPassword);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          resetToken: null,
          resetTokenExpiry: null,
          mustChangePassword: false,
        },
      });

      logger.info({ operation: 'password_reset_completed', userId: user.id });

      res.json({ message: 'Password has been reset successfully.' });
    } catch (error) {
      next(error);
    }
  },
);

// POST /force-change-password — used after login with mustChangePassword=true
router.post(
  '/force-change-password',
  passwordResetLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { newPassword } = forceChangePasswordSchema.parse(req.body);
      // Read changeToken from HttpOnly cookie (set during login) or fallback to body
      const changeToken: string | undefined =
        req.cookies?.change_token || req.body.changeToken;
      if (!changeToken) {
        throw new AppError('Change token is required', 400);
      }
      const hashedToken = hashToken(changeToken);

      const user = await prisma.user.findFirst({
        where: {
          changeToken: hashedToken,
          changeTokenExpiry: { gt: new Date() },
        },
      });

      if (!user) {
        throw new AppError('Invalid or expired change token', 400);
      }

      const newHash = await hashPassword(newPassword);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          changeToken: null,
          changeTokenExpiry: null,
          mustChangePassword: false,
        },
      });

      logger.info({ operation: 'force_password_change_completed', userId: user.id });

      // Clear the change_token cookie
      res.clearCookie('change_token', { path: '/' });
      res.json({ message: 'Password changed successfully.' });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
