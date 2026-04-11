import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import {
  createLinkInvitationSchema,
  createEmailInvitationSchema,
  listInvitationsQuerySchema,
} from '../../schemas/invitation';
import { sendInvitationEmail } from '../../services/emailService';
import { AppError } from '../../middleware/errorHandler';

const router = Router();

const MAX_USERS_DEFAULT = 10;

async function ensureUserLimitNotReached(tx: Prisma.TransactionClient): Promise<void> {
  const maxUsers = parseInt(process.env.MAX_USERS || String(MAX_USERS_DEFAULT), 10);
  const userCount = await tx.user.count();
  const activeInviteCount = await tx.invitation.count({
    where: {
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (userCount + activeInviteCount >= maxUsers) {
    throw new AppError('User limit reached', 409);
  }
}

function buildInviteUrl(token: string): string {
  const frontendUrl =
    process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:3000';
  return `${frontendUrl}/register?token=${token}`;
}

/**
 * POST /admin/invitations — create link-only invitation
 */
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { expiresInDays } = createLinkInvitationSchema.parse(req.body);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const invitation = await prisma.$transaction(
      async (tx) => {
        await ensureUserLimitNotReached(tx);
        return tx.invitation.create({
          data: {
            token,
            createdBy: req.userId!,
            expiresAt,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    res.json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
      },
      inviteUrl: buildInviteUrl(invitation.token),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/invitations/email — create invitation and send via SMTP
 */
router.post('/email', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { email, expiresInDays } = createEmailInvitationSchema.parse(req.body);
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const invitation = await prisma.$transaction(
      async (tx) => {
        await ensureUserLimitNotReached(tx);
        return tx.invitation.create({
          data: {
            email,
            token,
            createdBy: req.userId!,
            expiresAt,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );

    const inviteUrl = buildInviteUrl(invitation.token);
    const creator = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { username: true },
    });

    let emailSent = false;
    let emailError: string | null = null;
    try {
      await sendInvitationEmail(email, inviteUrl, creator?.username ?? 'an admin', expiresAt);
      emailSent = true;
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { emailStatus: 'sent', emailSentAt: new Date(), emailError: null },
      });
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Unknown send error';
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { emailStatus: 'failed', emailError },
      });
    }

    res.json({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
      },
      inviteUrl,
      emailSent,
      emailError,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/invitations/:id/resend — resend invitation email
 */
router.post('/:id/resend', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const invitation = await prisma.invitation.findUnique({ where: { id } });
    if (!invitation) {
      throw new AppError('Invitation not found', 404);
    }
    if (!invitation.email) {
      throw new AppError('Invitation has no email', 400);
    }
    if (invitation.usedAt) {
      throw new AppError('Invitation already used', 400);
    }
    if (invitation.expiresAt <= new Date()) {
      throw new AppError('Invitation expired', 400);
    }

    const inviteUrl = buildInviteUrl(invitation.token);
    const creator = await prisma.user.findUnique({
      where: { id: invitation.createdBy },
      select: { username: true },
    });

    let emailSent = false;
    let emailError: string | null = null;
    try {
      await sendInvitationEmail(
        invitation.email,
        inviteUrl,
        creator?.username ?? 'an admin',
        invitation.expiresAt,
      );
      emailSent = true;
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { emailStatus: 'sent', emailSentAt: new Date(), emailError: null },
      });
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Unknown send error';
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: { emailStatus: 'failed', emailError },
      });
    }

    res.json({ emailSent, emailError });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/invitations/:id — hard-delete an invitation
 */
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const result = await prisma.invitation.deleteMany({ where: { id } });
    if (result.count === 0) {
      throw new AppError('Invitation not found', 404);
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/invitations — list invitations (with status filter)
 */
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status } = listInvitationsQuerySchema.parse(req.query);
    const now = new Date();

    const where =
      status === 'active'
        ? { usedAt: null, expiresAt: { gt: now } }
        : status === 'used'
          ? { NOT: { usedAt: null } }
          : status === 'expired'
            ? { usedAt: null, expiresAt: { lte: now } }
            : {};

    const invitations = await prisma.invitation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        token: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
        emailStatus: true,
        emailError: true,
        emailSentAt: true,
        creator: { select: { username: true } },
        user: { select: { username: true } },
      },
    });

    res.json({ invitations });
  } catch (error) {
    next(error);
  }
});

export default router;
