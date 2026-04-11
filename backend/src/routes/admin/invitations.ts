import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';

const router = Router();

// Legacy create body — intentionally permissive during the refactor.
// Task 5 replaces this with createLinkInvitationSchema.
const legacyCreateSchema = z.object({
  email: z.string().email().optional(),
  expiresInDays: z.number().int().min(1).max(90).optional().default(7),
});

/**
 * POST /admin/invitations — create invitation
 */
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { email, expiresInDays } = legacyCreateSchema.parse(req.body);
    const token = crypto.randomBytes(32).toString('hex');

    const invitation = await prisma.invitation.create({
      data: {
        email,
        token,
        createdBy: req.userId!,
        expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
      },
    });

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
