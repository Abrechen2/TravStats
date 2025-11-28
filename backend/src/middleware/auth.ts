import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler';
import { JWT_SECRET } from '../utils/jwtSecret';
import { prisma } from '../db';

export interface AuthRequest extends Request {
  userId?: string;
}

export const authenticate = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    let token: string | undefined;

    // Try to get token from cookie first (preferred method - more secure)
    if (req.cookies && req.cookies.auth_token) {
      token = req.cookies.auth_token;
    }
    // Fallback to Authorization header for backwards compatibility
    else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.substring(7);
    }

    if (!token) {
      throw new AppError('No token provided', 401);
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = decoded.userId;

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError('Invalid token', 401));
    } else {
      next(error);
    }
  }
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
      throw new AppError('Admin access required', 403);
    }

    next();
  } catch (error) {
    next(error);
  }
};
