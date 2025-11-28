import { Router, Request, Response, NextFunction, CookieOptions } from 'express';
import { prisma } from '../db';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { registerSchema, loginSchema } from '../schemas/auth';
import { AppError } from '../middleware/errorHandler';
import { authLimiter } from '../middleware/rateLimit';

const router = Router();
const cookieMaxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
const cookieSecure = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE !== 'false'
  : process.env.NODE_ENV === 'production';
const authCookieOptions: CookieOptions = {
  httpOnly: true, // Prevents JavaScript access (XSS protection)
  secure: cookieSecure, // Allow HTTP in dev if COOKIE_SECURE=false
  sameSite: 'lax',
  maxAge: cookieMaxAgeMs,
  path: '/',
};

// Register
router.post('/register', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password, invitationToken } = req.body;

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
      console.warn(`Warning: Instance has ${userCount} users (recommended max: ${maxUsers})`);
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
    res.cookie('auth_token', token, authCookieOptions);

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

    // Generate token
    const token = generateToken(user.id);

    // Set HttpOnly cookie for security (XSS protection)
    res.cookie('auth_token', token, authCookieOptions);

    res.json({
      user: {
        id: user.id,
        username: user.username,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Logout
router.post('/logout', (req: Request, res: Response) => {
  // Clear the auth cookie
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    path: '/',
  });

  res.json({ message: 'Logged out successfully' });
});

export default router;
