import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { hashPassword } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { getAuthCookieOptions } from './auth';
import { AppError } from '../middleware/errorHandler';
import { getSeedingStatus } from '../services/airportSeedingService';
import { updateInstanceSettings } from '../services/instanceSettingsService';
import { authLimiter } from '../middleware/rateLimit';

const initializeSchema = z.object({
  username: z.string().min(1, 'Username is required').max(50),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  instanceName: z.string().max(100).optional(),
  frontendUrl: z.string().url('Frontend URL must be a valid URL').max(500).optional(),
  maxUsers: z.number().int().min(1).max(1000).optional(),
  allowRegistration: z.boolean().optional(),
});

const router = Router();

// Check setup status
router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userCount = await prisma.user.count();
    const adminCount = await prisma.user.count({
      where: { isAdmin: true },
    });

    // Setup is complete if at least one admin user exists
    const setupComplete = adminCount > 0;

    res.json({
      setupComplete,
      requiresSetup: !setupComplete,
      message: setupComplete
        ? 'Instance is configured'
        : userCount === 0
        ? 'Please create the first admin account'
        : 'Please create an admin account',
    });
  } catch (error) {
    next(error);
  }
});

// Initialize instance (only works if no admin users exist)
router.post('/initialize', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validated = initializeSchema.parse(req.body);
    const { username, password, instanceName, frontendUrl, maxUsers, allowRegistration } = validated;

    // Check if setup already completed (admin exists)
    const adminCount = await prisma.user.count({
      where: { isAdmin: true },
    });
    if (adminCount > 0) {
      throw new AppError('Setup already completed - admin user exists', 400);
    }

    // Create first admin user
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        isAdmin: true,
      },
    });

    // Persist instance-level settings captured during setup so the operator
    // never has to edit ENV variables after install.
    await updateInstanceSettings({
      ...(instanceName !== undefined && { instanceName }),
      ...(frontendUrl !== undefined && { frontendUrl }),
      ...(maxUsers !== undefined && { maxUsers }),
      ...(allowRegistration !== undefined && { allowRegistration }),
    });

    // Generate token and set HttpOnly cookie for automatic login
    const token = generateToken(user.id);
    res.cookie('auth_token', token, getAuthCookieOptions(req));

    res.json({
      success: true,
      message: 'Setup complete! You can now log in as admin.',
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

// Get airport seeding status
router.get('/airport-seeding-status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await getSeedingStatus();

    if (!status) {
      // No seeding needed or no status record
      return res.json({
        status: 'completed',
        progress: 1,
        estimatedSecondsRemaining: 0,
      });
    }

    res.json(status);
  } catch (error) {
    next(error);
  }
});

export default router;
