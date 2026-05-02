import { Router, Response, NextFunction } from 'express';
import type { ApiToken } from '@prisma/client';

import { AppError } from '../../middleware/errorHandler';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { createApiTokenSchema, type SanitizedApiToken } from '../../schemas/apiToken';
import { generateApiToken } from '../../utils/apiTokens';
import logger, { securityLogger } from '../../utils/logger';

/**
 * Personal Access Token (PAT) management routes.
 *
 * Mounted under /api/v1/settings/tokens. The list and revoke routes
 * deliberately omit `hash` and `lookupHash` from responses — those
 * are derived secrets that should never leave the DB layer. The
 * plaintext is returned exactly once, on POST.
 *
 * Cookie-only access: PATs cannot create / list / revoke other PATs.
 * That's enforced via `req.apiToken` being undefined on the cookie
 * path; if a Bearer token tries to manage tokens we hard-403 rather
 * than risk a malicious agent privilege-escalating itself by minting
 * a new admin token.
 */

const router = Router();

router.use((req: AuthRequest, _res: Response, next: NextFunction) => {
  if (req.apiToken) {
    securityLogger.warn({
      operation: 'security_event',
      message: 'PAT-authenticated request attempted to manage tokens',
      context: {
        eventType: 'pat_self_management_blocked',
        tokenId: req.apiToken.id,
        userId: req.userId,
        url: req.url,
      },
    });
    next(new AppError('Token management requires a browser session, not an API token', 403));
    return;
  }
  next();
});

const sanitize = (t: ApiToken): SanitizedApiToken => ({
  id: t.id,
  label: t.label,
  scope: t.scope as SanitizedApiToken['scope'],
  prefix: t.prefix,
  lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
  lastUsedIp: t.lastUsedIp,
  expiresAt: t.expiresAt?.toISOString() ?? null,
  revokedAt: t.revokedAt?.toISOString() ?? null,
  createdAt: t.createdAt.toISOString(),
});

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) throw new AppError('Unauthorized', 401);
    const tokens = await prisma.apiToken.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ tokens: tokens.map(sanitize) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) throw new AppError('Unauthorized', 401);
    const parsed = createApiTokenSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid input', 400);
    }
    const { label, scope, expiresAt } = parsed.data;

    const generated = await generateApiToken();
    const created = await prisma.apiToken.create({
      data: {
        userId: req.userId,
        label,
        scope,
        lookupHash: generated.lookupHash,
        hash: generated.hash,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    securityLogger.info({
      operation: 'security_event',
      message: 'API token created',
      context: {
        eventType: 'pat_created',
        tokenId: created.id,
        userId: req.userId,
        scope,
        ip: req.ip,
      },
    });

    res.status(201).json({
      ...sanitize(created),
      // ONLY here, ONLY once: the plaintext. The frontend must surface
      // a "save this now, it won't be shown again" warning.
      plaintext: generated.plaintext,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) throw new AppError('Unauthorized', 401);
    const { id } = req.params;
    const token = await prisma.apiToken.findUnique({ where: { id } });
    if (!token || token.userId !== req.userId) {
      // 404 (not 403) on cross-user — never leak the existence of
      // other users' token IDs.
      throw new AppError('Token not found', 404);
    }
    if (token.revokedAt) {
      res.json({ ...sanitize(token), alreadyRevoked: true });
      return;
    }
    const revoked = await prisma.apiToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    securityLogger.info({
      operation: 'security_event',
      message: 'API token revoked',
      context: {
        eventType: 'pat_revoked',
        tokenId: revoked.id,
        userId: req.userId,
        ip: req.ip,
      },
    });
    res.json(sanitize(revoked));
  } catch (err) {
    logger.error({ message: 'Failed to revoke API token', err });
    next(err);
  }
});

export default router;
