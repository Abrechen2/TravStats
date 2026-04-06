import { Router, Request, Response, NextFunction, CookieOptions } from 'express';
import crypto from 'crypto';
import { prisma } from '../db';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { registerSchema, loginSchema, changePasswordSchema } from '../schemas/auth';
import { AppError } from '../middleware/errorHandler';
import { authLimiter } from '../middleware/rateLimit';
import { authenticate, AuthRequest } from '../middleware/auth';
import logger from '../utils/logger';

const router = Router();
const cookieMaxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days

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
  sameSite: 'lax',
  maxAge: cookieMaxAgeMs,
  path: '/',
});

// Register
router.post('/register', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validate required fields
    const { username, password } = registerSchema.parse(req.body);
    const invitationToken =
      typeof req.body.invitationToken === 'string' ? req.body.invitationToken : undefined;

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
    const allowRegistration = process.env.ALLOW_REGISTRATION !== 'false';
    const maxUsers = parseInt(process.env.MAX_USERS || '10');

    // Validate registration is allowed
    if (!isFirstUser && !allowRegistration && !invitationToken) {
      throw new AppError('Registration is disabled. Please use an invitation link.', 403);
    }

    // Validate invitation token if provided
    let invitedBy: string | undefined;
    if (invitationToken) {
      const invitation = await prisma.invitation.findUnique({
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
    }

    // Warning if approaching user limit
    if (userCount >= maxUsers) {
      logger.warn({
        operation: 'auth_user_limit_warning',
        message: `Instance has ${userCount} users (recommended max: ${maxUsers})`,
        context: { userCount, maxUsers },
      });
    }

    // Create user (first user becomes admin)
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        isAdmin: isFirstUser,
        invitedBy,
      },
    });

    // Mark invitation as used
    if (invitationToken) {
      await prisma.invitation.update({
        where: { token: invitationToken },
        data: {
          usedAt: new Date(),
          usedBy: user.id,
        },
      });
    }

    // Generate token
    const token = generateToken(user.id);

    // Set HttpOnly cookie for security (XSS protection)
    res.cookie('auth_token', token, getAuthCookieOptions(req));

    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        isAdmin: user.isAdmin,
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

    // Find user
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      throw new AppError('Invalid credentials', 401);
    }

    // Verify password
    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      throw new AppError('Invalid credentials', 401);
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

      return res.json({ requiresPasswordChange: true, changeToken: plainChangeToken });
    }

    // Generate token
    const token = generateToken(user.id);

    // Set HttpOnly cookie for security (XSS protection)
    res.cookie('auth_token', token, getAuthCookieOptions(req));

    // Start airport seeding if needed (only on first login, if no airports exist)
    try {
      const airportCount = await prisma.airport.count();
      const seedAirportsEnv = process.env.SEED_AIRPORTS;
      const shouldSeedAirports = seedAirportsEnv !== 'false';

      if (shouldSeedAirports && airportCount === 0) {
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
      },
    });
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
