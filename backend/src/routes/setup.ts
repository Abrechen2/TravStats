import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { hashPassword } from '../utils/password';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// Check setup status
router.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userCount = await prisma.user.count();
    const setupComplete = userCount > 0;

    res.json({
      setupComplete,
      requiresSetup: !setupComplete,
      message: setupComplete
        ? 'Instance is configured'
        : 'Please create the first admin account',
    });
  } catch (error) {
    next(error);
  }
});

// Initialize instance (only works if no users exist)
router.post('/initialize', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password, instanceName } = req.body;

    // Check if setup already completed
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      throw new AppError('Setup already completed', 400);
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

export default router;
