import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler';
import { JWT_SECRET } from '../utils/jwtSecret';
import { prisma } from '../db';
import { securityLogger } from '../utils/logger';
import {
  ApiTokenScope,
  looksLikeApiToken,
  tokenLookupHash,
  verifyApiToken,
} from '../utils/apiTokens';

export interface AuthRequest extends Request {
  userId?: string;
  /**
   * When the request authenticated via Personal Access Token (PAT),
   * this is populated. Cookie sessions leave it undefined. Route
   * guards that mutate state should consult `tokenScope` to enforce
   * read-only / write / admin tokens.
   */
  apiToken?: {
    id: string;
    scope: ApiTokenScope;
  };
}

/**
 * Authenticate the incoming request. Two paths are supported:
 *
 *   1. `Authorization: Bearer ts_pat_…` → Personal Access Token. Looked
 *      up via SHA-256 index for O(1) row retrieval, then constant-time
 *      bcrypt-verified. `lastUsedAt` + `lastUsedIp` are bumped fire-
 *      and-forget so an exhausting bcrypt cost isn't paid twice.
 *
 *   2. `Cookie: auth_token=<jwt>` → browser session (the only path the
 *      frontend uses). HttpOnly cookie, no Bearer fallback for cookie
 *      JWTs — that posture is intentional and unchanged here.
 *
 * If both are present, the Bearer header wins. This matches GitHub /
 * GitLab behaviour: explicit credentials beat ambient session.
 */
export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const bearer = extractBearer(req.headers.authorization);
    if (bearer) {
      await authenticateWithApiToken(req, bearer);
      next();
      return;
    }

    const cookieToken = req.cookies?.auth_token as string | undefined;
    if (!cookieToken) {
      securityLogger.warn({
        operation: 'security_event',
        message: 'Authentication failed: No token provided',
        context: {
          eventType: 'auth_failure',
          reason: 'no_token',
          ip: req.ip,
          userAgent: req.get('user-agent'),
          url: req.url,
        },
      });
      throw new AppError('No token provided', 401);
    }

    const decoded = jwt.verify(cookieToken, JWT_SECRET) as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, isActive: true },
    });

    if (!user) {
      securityLogger.warn({
        operation: 'security_event',
        message: 'Authentication failed: User not found',
        context: {
          eventType: 'auth_failure',
          reason: 'user_not_found',
          userId: decoded.userId,
          ip: req.ip,
          userAgent: req.get('user-agent'),
          url: req.url,
        },
      });
      throw new AppError('Invalid token - user not found', 401);
    }

    if (!user.isActive) {
      securityLogger.warn({
        operation: 'security_event',
        message: 'Authentication failed: Account deactivated',
        context: {
          eventType: 'auth_failure',
          reason: 'account_deactivated',
          userId: decoded.userId,
          ip: req.ip,
          userAgent: req.get('user-agent'),
          url: req.url,
        },
      });
      throw new AppError('Account has been deactivated', 403);
    }

    req.userId = decoded.userId;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      securityLogger.warn({
        operation: 'security_event',
        message: 'Authentication failed: Invalid token',
        context: {
          eventType: 'invalid_token',
          reason: error.message,
          ip: req.ip,
          userAgent: req.get('user-agent'),
          url: req.url,
        },
      });
      next(new AppError('Invalid token', 401));
    } else {
      next(error);
    }
  }
};

const extractBearer = (header: string | undefined): string | undefined => {
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
};

async function authenticateWithApiToken(req: AuthRequest, plaintext: string): Promise<void> {
  // Reject obviously malformed tokens before hitting the DB so a
  // misconfigured proxy spamming bogus Authorization headers can't
  // turn into a bcrypt-comparison DoS.
  if (!looksLikeApiToken(plaintext)) {
    securityLogger.warn({
      operation: 'security_event',
      message: 'API token rejected: malformed',
      context: {
        eventType: 'auth_failure',
        reason: 'malformed_pat',
        ip: req.ip,
        userAgent: req.get('user-agent'),
        url: req.url,
      },
    });
    throw new AppError('Invalid API token', 401);
  }

  const lookup = tokenLookupHash(plaintext);
  const token = await prisma.apiToken.findUnique({
    where: { lookupHash: lookup },
    include: { user: { select: { id: true, isActive: true } } },
  });

  if (!token) {
    securityLogger.warn({
      operation: 'security_event',
      message: 'API token rejected: unknown',
      context: {
        eventType: 'auth_failure',
        reason: 'unknown_pat',
        ip: req.ip,
        userAgent: req.get('user-agent'),
        url: req.url,
      },
    });
    throw new AppError('Invalid API token', 401);
  }

  if (token.revokedAt) {
    securityLogger.warn({
      operation: 'security_event',
      message: 'API token rejected: revoked',
      context: {
        eventType: 'auth_failure',
        reason: 'revoked_pat',
        tokenId: token.id,
        userId: token.userId,
        ip: req.ip,
        url: req.url,
      },
    });
    throw new AppError('API token revoked', 401);
  }

  if (token.expiresAt && token.expiresAt.getTime() < Date.now()) {
    throw new AppError('API token expired', 401);
  }

  // Constant-time secret check — never short-circuit on the lookup
  // hash alone, since it's a fast SHA-256.
  const ok = await verifyApiToken(plaintext, token.hash);
  if (!ok) {
    securityLogger.warn({
      operation: 'security_event',
      message: 'API token rejected: hash mismatch',
      context: {
        eventType: 'auth_failure',
        reason: 'pat_hash_mismatch',
        tokenId: token.id,
        userId: token.userId,
        ip: req.ip,
        url: req.url,
      },
    });
    throw new AppError('Invalid API token', 401);
  }

  if (!token.user.isActive) {
    throw new AppError('Account has been deactivated', 403);
  }

  req.userId = token.userId;
  req.apiToken = { id: token.id, scope: token.scope as ApiTokenScope };

  // Bump last-used metadata fire-and-forget. A failure here MUST NOT
  // reject the request; this is just bookkeeping for the user's "are
  // any of my tokens stale?" UI.
  void prisma.apiToken
    .update({
      where: { id: token.id },
      data: { lastUsedAt: new Date(), lastUsedIp: req.ip ?? null },
    })
    .catch(() => undefined);
}

/**
 * Route guard that requires a write-or-admin scope when the request
 * authenticated via PAT. Read-only tokens are explicitly blocked from
 * mutating endpoints. Cookie sessions are not constrained by scope —
 * the user is the resource owner via their browser.
 *
 * Method-aware: GET / HEAD / OPTIONS pass through unconditionally so this
 * middleware can be safely applied at the router level via `router.use()`
 * without separately distinguishing read vs write routes.
 */
export const requireWriteScope = (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  if (!req.apiToken) {
    next();
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (req.apiToken.scope === 'read') {
    securityLogger.warn({
      operation: 'security_event',
      message: 'API token denied: insufficient scope (write required)',
      context: {
        eventType: 'auth_failure',
        reason: 'pat_scope_insufficient',
        tokenId: req.apiToken.id,
        userId: req.userId,
        url: req.url,
      },
    });
    next(new AppError('API token lacks write scope', 403));
    return;
  }
  next();
};

export const requireAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.userId) {
      throw new AppError('Unauthorized', 401);
    }

    // PATs need an explicit admin scope on top of the user's admin flag —
    // a write-scoped token must NOT inherit admin privileges just because
    // the owning user happens to be an admin.
    if (req.apiToken && req.apiToken.scope !== 'admin') {
      throw new AppError('API token lacks admin scope', 403);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { isAdmin: true, isActive: true },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (!user.isActive) {
      throw new AppError('Account has been deactivated', 403);
    }

    if (!user.isAdmin) {
      securityLogger.warn({
        operation: 'security_event',
        message: 'Admin access denied',
        context: {
          eventType: 'admin_access_denied',
          userId: req.userId,
          ip: req.ip,
          userAgent: req.get('user-agent'),
          url: req.url,
        },
      });
      throw new AppError('Admin access required', 403);
    }

    next();
  } catch (error) {
    next(error);
  }
};
