import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { registerSchema, loginSchema } from '../schemas/auth';
import { AppError } from '../middleware/errorHandler';
import { authLimiter } from '../middleware/rateLimit';

const router = Router();

// Register
router.post('/register', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = registerSchema.parse(req.body);

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw new AppError('Username already exists', 400);
    }

    // Create user
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
      },
    });

    // Generate token
    const token = generateToken(user.id);

    // Set HttpOnly cookie for security (XSS protection)
    res.cookie('auth_token', token, {
      httpOnly: true,  // Prevents JavaScript access (XSS protection)
      secure: process.env.COOKIE_SECURE !== 'false',  // Allow HTTP for reverse proxies/dev
      sameSite: 'lax',  // Allow mobile/LAN clients while keeping CSRF protection
      maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
      path: '/',
    });

    res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
      },
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
    res.cookie('auth_token', token, {
      httpOnly: true,  // Prevents JavaScript access (XSS protection)
      secure: process.env.COOKIE_SECURE !== 'false',  // Allow HTTP for reverse proxies/dev
      sameSite: 'lax',  // Allow mobile/LAN clients while keeping CSRF protection
      maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
      path: '/',
    });

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
    secure: process.env.COOKIE_SECURE !== 'false',
    sameSite: 'lax',
    path: '/',
  });

  res.json({ message: 'Logged out successfully' });
});

export default router;
