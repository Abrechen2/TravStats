import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { hashPassword } from '../utils/password';
import { AppError } from '../middleware/errorHandler';
import { getSeedingStatus } from '../services/airportSeedingService';

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
router.post('/initialize', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password, instanceName } = req.body;

    // Check if setup already completed (admin exists)
    const adminCount = await prisma.user.count({
      where: { isAdmin: true },
    });
    if (adminCount > 0) {
      throw new AppError('Setup already completed - admin user exists', 400);
    }

    // Validate input
    if (!username || !password) {
      throw new AppError('Username and password are required', 400);
    }

    if (password.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400);
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
