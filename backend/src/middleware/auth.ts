import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from './errorHandler';
import { JWT_SECRET } from '../utils/jwtSecret';
import { prisma } from '../db';
import { securityLogger } from '../utils/logger';

export interface AuthRequest extends Request {
  userId?: string;
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    let token: string | undefined;

    // JWT is only accepted from HttpOnly cookie — Bearer header fallback removed
    // to prevent XSS from accessing the token via JavaScript
    if (req.cookies && req.cookies.auth_token) {
      token = req.cookies.auth_token;
    }

    if (!token) {
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

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    // Verify user exists in database
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
