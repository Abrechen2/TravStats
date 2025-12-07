import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { prisma } from '../db';
import { AppError } from './errorHandler';
import logger from '../utils/logger';

/**
 * Middleware to check if user has access to training features
 * Requires either admin role or explicit canTrainLLM permission
 */
export const requireTrainingAccess = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.userId) {
      throw new AppError('Unauthorized', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { isAdmin: true, canTrainLLM: true, isActive: true },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    if (!user.isActive) {
      throw new AppError('Account has been deactivated', 403);
    }

    if (!user.isAdmin && !user.canTrainLLM) {
      logger.warn({
        operation: 'training_access_denied',
        message: 'Training access denied',
        context: {
          userId: req.userId,
          isAdmin: user.isAdmin,
          canTrainLLM: user.canTrainLLM,
        },
      });
      throw new AppError('Training access requires admin privileges or explicit permission', 403);
    }

    next();
  } catch (error) {
    next(error);
  }
};


