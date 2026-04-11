import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { createLinkInvitationSchema } from '../../schemas/invitation';
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
 * GET /admin/invitations — list invitations
 */
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
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
        creator: { select: { username: true } },
      },
    });

    res.json({ invitations });
  } catch (error) {
    next(error);
  }
});

export default router;
