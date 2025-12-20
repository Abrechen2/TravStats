import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { errorHandler, AppError } from '../middleware/errorHandler';
import { ZodError, z } from 'zod';

// Mock logger
jest.mock('../utils/logger', () => ({
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock('../services/loggingConfig', () => ({
  isDebugEnabled: jest.fn().mockResolvedValue(false),
}));

describe('Middleware Tests', () => {
  describe('Error Handler', () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;
    let jsonMock: any;
    let statusMock: any;

    beforeEach(() => {
      jsonMock = jest.fn();
      statusMock = jest.fn().mockReturnValue({ json: jsonMock });

      mockReq = {
        method: 'GET',
        url: '/api/test',
        path: '/api/test',
        query: {},
        ip: '127.0.0.1',
        get: jest.fn().mockReturnValue('test-user-agent'),
      };
      mockRes = {
        status: statusMock,
        json: jsonMock,
      };
      mockNext = jest.fn();
    });

    describe('AppError', () => {
      it('should handle AppError with status code', async () => {
        const error = new AppError('Test error', 404);

        await errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(404);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Test error',
          })
        );
      });

      it('should handle AppError with default 500 status', async () => {
        const error = new AppError('Internal error');

        await errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Internal error',
          })
        );
      });

      it('should include stack trace in development', async () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        const error = new AppError('Test error', 500);

        await errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            stack: expect.any(String),
          })
        );

        process.env.NODE_ENV = originalEnv;
      });

      it('should not include stack trace in production', async () => {
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';

        const error = new AppError('Test error', 500);

        await errorHandler(error, mockReq as Request, mockRes as Response, mockNext);

        const callArg = jsonMock.mock.calls[0][0];
        expect(callArg.stack).toBeUndefined();

        process.env.NODE_ENV = originalEnv;
      });
    });

    describe('Zod Validation Errors', () => {
      it('should handle Zod validation errors', async () => {
        const schema = z.object({
          email: z.string().email(),
          age: z.number().min(18),
        });

        let zodError: ZodError;
        try {
          schema.parse({ email: 'invalid', age: 15 });
        } catch (err) {
          zodError = err as ZodError;
        }

        await errorHandler(zodError!, mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Validation error',
            details: expect.arrayContaining([
              expect.objectContaining({
                field: expect.any(String),
                message: expect.any(String),
              }),
            ]),
          })
        );
      });

      it('should format Zod errors with field paths', async () => {
        const schema = z.object({
          user: z.object({
            email: z.string().email(),
          }),
        });

        let zodError: ZodError;
        try {
          schema.parse({ user: { email: 'invalid' } });
        } catch (err) {
          zodError = err as ZodError;
        }

        await errorHandler(zodError!, mockReq as Request, mockRes as Response, mockNext);

        const response = jsonMock.mock.calls[0][0];
        expect(response.details).toBeDefined();
        expect(response.details[0].field).toBe('user.email');
      });
    });

    describe('Generic Errors', () => {
      it('should handle generic Error objects', async () => {
        const error = new Error('Something went wrong');

        await errorHandler(error as any, mockReq as Request, mockRes as Response, mockNext);

        expect(statusMock).toHaveBeenCalledWith(500);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Something went wrong',
          })
        );
      });
    });

    describe('Error Categorization', () => {
      it('should log different error categories', async () => {
        const logger = await import('../utils/logger');

        // 401 auth error
        await errorHandler(
          new AppError('Unauthorized', 401),
          mockReq as Request,
          mockRes as Response,
          mockNext
        );
        expect(logger.default.error).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({
              errorCategory: 'auth_error',
            }),
          })
        );

        // 403 forbidden error
        await errorHandler(
          new AppError('Forbidden', 403),
          mockReq as Request,
          mockRes as Response,
          mockNext
        );
        expect(logger.default.error).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({
              errorCategory: 'forbidden_error',
            }),
          })
        );

        // 404 not found error
        await errorHandler(
          new AppError('Not found', 404),
          mockReq as Request,
          mockRes as Response,
          mockNext
        );
        expect(logger.default.error).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({
              errorCategory: 'not_found_error',
            }),
          })
        );

        // 500 server error
        await errorHandler(
          new AppError('Server error', 500),
          mockReq as Request,
          mockRes as Response,
          mockNext
        );
        expect(logger.default.error).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({
              errorCategory: 'server_error',
            }),
          })
        );
      });
    });
  });

  describe('AppError Class', () => {
    it('should create AppError with message and status code', () => {
      const error = new AppError('Test error', 404);

      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(404);
      expect(error.name).toBe('AppError');
      expect(error instanceof Error).toBe(true);
    });

    it('should default to status code 500', () => {
      const error = new AppError('Test error');

      expect(error.statusCode).toBe(500);
    });

    it('should have stack trace', () => {
      const error = new AppError('Test error', 400);

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('AppError');
    });
  });
});
