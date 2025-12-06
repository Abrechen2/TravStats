import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import logger from '../utils/logger';
import { isDebugEnabled } from '../services/loggingConfig';

export interface ApiError extends Error {
  statusCode?: number;
}

interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    isAdmin: boolean;
  };
  requestId?: string;
}

/**
 * Categorize error type for structured logging
 */
function categorizeError(err: ApiError | ZodError): string {
  if (err instanceof ZodError) return 'validation_error';
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    if (err.statusCode === 401) return 'auth_error';
    if (err.statusCode === 403) return 'forbidden_error';
    if (err.statusCode === 404) return 'not_found_error';
    return 'client_error';
  }
  if (err.statusCode && err.statusCode >= 500) return 'server_error';
  return 'unknown_error';
}

export const errorHandler = async (
  err: ApiError | ZodError,
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const debugEnabled = await isDebugEnabled().catch(() => false);
  const errorCategory = categorizeError(err);

  // Structured AI-friendly error logging
  logger.error({
    category: 'error',
    operation: 'error_handler',
    message: err.message,
    context: {
      method: req.method,
      url: req.url,
      path: req.path,
      query: req.query,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.id,
      username: req.user?.username,
      requestId: req.requestId,
      errorCategory,
      statusCode: err instanceof ZodError ? 400 : err.statusCode || 500,
    },
    error: {
      name: err.name,
      message: err.message,
      // Only include stack trace in debug mode or development
      stack: (debugEnabled || process.env.NODE_ENV === 'development') ? err.stack : undefined,
      // Include Zod validation details if applicable
      ...(err instanceof ZodError && {
        validationErrors: err.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
          code: e.code,
        })),
      }),
    },
  });

  // Zod validation errors
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors.map(e => ({
        field: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  // Custom API errors
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}
