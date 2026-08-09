import { Router, Request, Response, NextFunction, CookieOptions } from 'express';
import crypto from 'crypto';
import { prisma } from '../db';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { registerSchema, loginSchema, changePasswordSchema } from '../schemas/auth';
import { AppError } from '../middleware/errorHandler';
import { authLimiter } from '../middleware/rateLimit';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getInstanceSettings } from '../services/instanceSettingsService';
import logger from '../utils/logger';

const router = Router();
const cookieMaxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days

// Dummy bcrypt hash used to prevent timing oracle on login (constant-time for unknown users)
const DUMMY_BCRYPT_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012';

// Determine if cookies should be secure
// If COOKIE_SECURE is explicitly set, use that value
// Otherwise, use secure cookies only if explicitly in production AND behind HTTPS
function getCookieSecure(req: Request): boolean {
  // If COOKIE_SECURE is explicitly set in env, use it
  if (process.env.COOKIE_SECURE !== undefined) {
    return process.env.COOKIE_SECURE !== 'false';
  }

  // Auto-detect: Check if request is over HTTPS (via proxy header)
  // req.protocol is automatically set by Express when trust proxy is enabled
  if (process.env.NODE_ENV === 'production') {
    return req.protocol === 'https' || req.get('x-forwarded-proto') === 'https';
  }

  // In development, default to false (allow HTTP)
  return false;
}

export const getAuthCookieOptions = (req: Request): CookieOptions => ({
  httpOnly: true, // Prevents JavaScript access (XSS protection)
  secure: getCookieSecure(req), // Auto-detect HTTPS or use COOKIE_SECURE env var
  sameSite: 'strict',
  maxAge: cookieMaxAgeMs,
  path: '/',
});

// Register
router.post('/register', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate required fields
    const { username, password } = registerSchema.parse(req.body);
    const rawToken = req.body.invitationToken;
    const invitationToken =
      typeof rawToken === 'string' && rawToken.length <= 128 ? rawToken : undefined;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw new AppError('Username already exists', 400);
    }

    // Check registration permissions
    const userCount = await prisma.user.count();
    const isFirstUser = userCount === 0;
    const instanceSettings = await getInstanceSettings();
    const { allowRegistration, maxUsers } = instanceSettings;

    // Enforce MAX_USERS hard limit regardless of registration mode
    if (!isFirstUser && userCount >= maxUsers) {
      throw new AppError('User limit reached', 409);
    }

    // Validate registration is allowed
    if (!isFirstUser && !allowRegistration && !invitationToken) {
      throw new AppError('Registration is disabled. Please use an invitation link.', 403);
    }

    // Hash password before the transaction to keep the critical section short
    const passwordHash = await hashPassword(password);

    // Use a serializable transaction to prevent race conditions with
    // invitation tokens (double-use) and user limit enforcement.
    const user = await prisma.$transaction(async (tx) => {
      // Validate invitation token if provided
      let invitedBy: string | undefined;
      let invitationEmail: string | undefined;
      if (invitationToken) {
        const invitation = await tx.invitation.findUnique({
          where: { token: invitationToken },
        });

        if (!invitation) {
          throw new AppError('Invalid invitation token', 400);
        }

        if (invitation.usedAt) {
          throw new AppError('Invitation token already used', 400);
        }

        if (invitation.expiresAt < new Date()) {
          throw new AppError('Invitation token has expired', 400);
        }

        invitedBy = invitation.createdBy;
        invitationEmail = invitation.email ?? undefined;
      }

      // Create user (first user becomes admin)
      const created = await tx.user.create({
        data: {
          username,
          passwordHash,
          isAdmin: isFirstUser,
          invitedBy,
          notificationEmail: invitationEmail,
        },
      });

      // Mark invitation as used within the same transaction
      if (invitationToken) {
        await tx.invitation.update({
          where: { token: invitationToken },
          data: {
            usedAt: new Date(),
            usedBy: created.id,
          },
        });
      }

      return created;
    }, {
      isolationLevel: 'Serializable',
    });

    // Generate token
    const token = generateToken(user.id);

    // Set HttpOnly cookie for security (XSS protection)
    res.cookie('auth_token', token, getAuthCookieOptions(req));

    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      message: isFirstUser ? 'Welcome! You are the admin of this instance.' : 'Account created successfully',
    });
  } catch (error) {
    next(error);
  }
});

// Login
router.post('/login', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    // Find user — always run bcrypt to prevent timing-based username enumeration
    const user = await prisma.user.findUnique({
      where: { username },
    });

    const isValid = await comparePassword(password, user?.passwordHash ?? DUMMY_BCRYPT_HASH);
    if (!user || !isValid) {
      throw new AppError('Invalid credentials', 401);
    }

    // Two-factor: the password was right, so the session is withheld until the
    // second factor arrives. Same shape as the mustChangePassword branch below —
    // a challenge in an HttpOnly cookie, never in the response body.
    //
    // ORDER MATTERS. This block must sit ABOVE the mustChangePassword branch, not
    // below it. An account carrying both flags would otherwise be handed a
    // change_token on password alone, and POST /force-change-password consumes
    // only that cookie — so an attacker who knows the password could set a new
    // one and never meet the second factor. Two-factor first, always.
    if (user.twoFactorEnabledAt) {
      const plainChallenge = crypto.randomBytes(32).toString('hex');
      const hashedChallenge = crypto.createHash('sha256').update(plainChallenge).digest('hex');

      await prisma.user.update({
        where: { id: user.id },
        data: {
          twoFactorToken: hashedChallenge,
          twoFactorTokenExpiry: new Date(Date.now() + 5 * 60 * 1000), // 5 min
        },
      });

      res.cookie('twofa_token', plainChallenge, {
        httpOnly: true,
        secure: getCookieSecure(req),
        sameSite: 'strict',
        maxAge: 5 * 60 * 1000,
        path: '/',
      });
      return res.json({ requiresTwoFactor: true });
    }

    // Check if user must change password before allowing login
    if (user.mustChangePassword) {
      const plainChangeToken = crypto.randomBytes(32).toString('hex');
      const hashedChangeToken = crypto.createHash('sha256').update(plainChangeToken).digest('hex');

      await prisma.user.update({
        where: { id: user.id },
        data: {
          changeToken: hashedChangeToken,
          changeTokenExpiry: new Date(Date.now() + 10 * 60 * 1000), // 10 min
        },
      });

      // Deliver changeToken via HttpOnly cookie (not response body) to prevent XSS extraction
      res.cookie('change_token', plainChangeToken, {
        httpOnly: true,
        secure: getCookieSecure(req),
        sameSite: 'strict',
        maxAge: 10 * 60 * 1000, // 10 minutes
        path: '/',
      });
      return res.json({ requiresPasswordChange: true });
    }

    // Generate token
    const token = generateToken(user.id);

    // Set HttpOnly cookie for security (XSS protection)
    res.cookie('auth_token', token, getAuthCookieOptions(req));

    // Start airport seeding if the catalogue is empty OR was left truncated by
    // an interrupted run. Keying this on `count === 0` meant a partial seed
    // never got a second chance, and the missing airports resolved no timezone
    // and no country for the life of the instance.
    try {
      const { isAirportCatalogueHealthy } = await import('../services/airportSeedingService');
      const catalogueHealthy = await isAirportCatalogueHealthy();
      const seedAirportsEnv = process.env.SEED_AIRPORTS;
      const shouldSeedAirports = seedAirportsEnv !== 'false';

      if (shouldSeedAirports && !catalogueHealthy) {
        // Check if seeding is already running
        const existingStatus = await prisma.airportSeedingStatus.findFirst({
          where: {
            status: { in: ['pending', 'running'] },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (!existingStatus) {
          try {
            // Try to create a new seeding status record
            // This will fail if another process already created one (race condition protection)
            const { startAirportSeeding } = await import('../services/airportSeedingService');
            await startAirportSeeding();
            logger.info({
              operation: 'login_start_airport_seeding',
              message: 'Airport seeding started after first login',
              context: { userId: user.id, username: user.username },
            });
          } catch (error: unknown) {
            // If another process already started seeding, ignore the error
            const prismaError = error as { code?: string };
            if (prismaError.code === 'P2002') {
              // P2002 = unique constraint violation (if we add a unique constraint)
              logger.debug({
                operation: 'login_airport_seeding_already_running',
                message: 'Airport seeding already started by another process',
                context: { userId: user.id },
              });
            } else {
              // Re-throw other errors
              throw error;
            }
          }
        }
      }
    } catch (error) {
      // Log error but don't fail login
      logger.warn({
        operation: 'login_airport_seeding_error',
        message: 'Failed to start airport seeding after login',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    res.json({
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
        // The header greets by first name and falls back to the username
        // (#241). Sending it with the login response means the greeting is
        // right on the first paint instead of flashing the username.
        firstName: user.firstName,
        lastName: user.lastName,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Current session. The client holds its "logged in" state in localStorage, which
// has no expiry, while the auth cookie expires after 7 days — so on boot it must
// ask the server whether the session is still real before rendering anything
// protected. Returns the same user shape as login.
router.get('/me', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) {
      throw new AppError('No token provided', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        username: true,
        isAdmin: true,
        firstName: true,
        lastName: true,
      },
    });

    if (!user) {
      throw new AppError('Invalid token - user not found', 401);
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// Logout
router.post('/logout', (req: Request, res: Response) => {
  // Clear the auth cookie (use same options as when setting it)
  res.clearCookie('auth_token', getAuthCookieOptions(req));

  res.json({ message: 'Logged out successfully' });
});

// Change Password (requires authentication)
router.post('/change-password', authenticate, authLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { oldPassword, newPassword } = changePasswordSchema.parse(req.body);
    const userId = req.userId!;

    // Find user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Verify old password
    const isValid = await comparePassword(oldPassword, user.passwordHash);
    if (!isValid) {
      throw new AppError('Current password is incorrect', 401);
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    logger.info({
      operation: 'password_changed',
      message: 'User changed password',
      context: { userId },
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
