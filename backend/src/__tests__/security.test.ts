import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { generateToken, verifyToken } from '../utils/jwt';
import { hashPassword, comparePassword } from '../utils/password';
import { prisma } from '../db';

// Mock dependencies (defined inline in factory to avoid jest hoisting TDZ)
jest.mock('../utils/logger', () => {
  const catLogger = () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
  });
  return {
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  securityLogger: catLogger(),
  dbLogger: catLogger(),
  httpLogger: catLogger(),
  parserLogger: catLogger(),
  parserVisionLogger: catLogger(),
  parserTextLogger: catLogger(),
  parserFactoryLogger: catLogger(),
  systemLogger: catLogger(),
  initializeCategoryStreams: jest.fn(),
  reinitializeCategoryStreams: jest.fn(),
  PerformanceTracker: jest.fn().mockImplementation(() => ({
    end: jest.fn(),
  })),
  generateRequestId: jest.fn(() => 'test-request-id'),
  enrichWithRequest: jest.fn(() => ({})),
  logRequest: jest.fn(),
  logQuery: jest.fn(),
  logApiCall: jest.fn(),
  logAchievement: jest.fn(),
  logSecurityEvent: jest.fn(),
  };
});

describe('Security Tests', () => {
  describe('JWT Utils', () => {
    describe('generateToken', () => {
      it('should generate a valid JWT token', () => {
        const userId = 'test-user-id';
        const token = generateToken(userId);

        expect(token).toBeDefined();
        expect(typeof token).toBe('string');
        expect(token.split('.').length).toBe(3); // JWT has 3 parts
      });

      it('should generate different tokens for different user IDs', () => {
        const token1 = generateToken('user-1');
        const token2 = generateToken('user-2');

        expect(token1).not.toBe(token2);
      });
    });

    describe('verifyToken', () => {
      it('should verify and decode a valid token', () => {
        const userId = 'test-user-id';
        const token = generateToken(userId);

        const decoded = verifyToken(token);

        expect(decoded.userId).toBe(userId);
      });

      it('should throw error for invalid token', () => {
        const invalidToken = 'invalid.token.here';

        expect(() => verifyToken(invalidToken)).toThrow();
      });

      it('should throw error for tampered token', () => {
        const userId = 'test-user-id';
        const token = generateToken(userId);
        const tamperedToken = token.slice(0, -5) + 'xxxxx';

        expect(() => verifyToken(tamperedToken)).toThrow();
      });
    });
  });

  describe('Password Utils', () => {
    describe('hashPassword', () => {
      it('should hash a password', async () => {
        const password = 'test-password-123';
        const hash = await hashPassword(password);

        expect(hash).toBeDefined();
        expect(hash).not.toBe(password);
        expect(hash.length).toBeGreaterThan(0);
      });

      it('should generate different hashes for same password', async () => {
        const password = 'test-password-123';
        const hash1 = await hashPassword(password);
        const hash2 = await hashPassword(password);

        // Bcrypt uses salts, so same password should have different hashes
        expect(hash1).not.toBe(hash2);
      });

      it('should handle empty password', async () => {
        const hash = await hashPassword('');

        expect(hash).toBeDefined();
        expect(hash.length).toBeGreaterThan(0);
      });
    });

    describe('comparePassword', () => {
      it('should return true for matching password and hash', async () => {
        const password = 'test-password-123';
        const hash = await hashPassword(password);

        const result = await comparePassword(password, hash);

        expect(result).toBe(true);
      });

      it('should return false for non-matching password', async () => {
        const password = 'test-password-123';
        const hash = await hashPassword(password);

        const result = await comparePassword('wrong-password', hash);

        expect(result).toBe(false);
      });

      it('should return false for invalid hash', async () => {
        const password = 'test-password-123';
        const invalidHash = 'invalid-hash';

        const result = await comparePassword(password, invalidHash);

        expect(result).toBe(false);
      });

      it('should be case-sensitive', async () => {
        const password = 'TestPassword123';
        const hash = await hashPassword(password);

        const result1 = await comparePassword('TestPassword123', hash);
        const result2 = await comparePassword('testpassword123', hash);

        expect(result1).toBe(true);
        expect(result2).toBe(false);
      });
    });
  });

  describe('Auth Middleware', () => {
    let mockReq: Partial<AuthRequest>;
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;
    let testUser: any;

    beforeEach(async () => {
      // Create test user
      const timestamp = Date.now();
      testUser = await prisma.user.create({
        data: {
          username: `auth-test-${timestamp}`,
          passwordHash: await hashPassword('test-password'),
          isActive: true,
          isAdmin: false,
        },
      });

      mockReq = {
        cookies: {},
        headers: {},
        ip: '127.0.0.1',
        get: jest
          .fn((header: string) =>
            header === 'set-cookie' ? ([] as string[]) : 'test-user-agent'
          ) as unknown as Request['get'],
        url: '/api/test',
      };
      mockRes = {};
      mockNext = jest.fn();
    });

    afterEach(async () => {
      if (testUser) {
        await prisma.user.delete({ where: { id: testUser.id } }).catch(() => {});
      }
      jest.clearAllMocks();
    });

    describe('authenticate', () => {
      it('should authenticate user with valid cookie token', async () => {
        const token = generateToken(testUser.id);
        mockReq.cookies = { auth_token: token };

        await authenticate(mockReq as AuthRequest, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledWith();
        expect(mockReq.userId).toBe(testUser.id);
      });

      it('should reject Bearer-token-only requests (cookie-only auth policy)', async () => {
        // XSS-hardening: the middleware intentionally ignores Authorization
        // headers so a stolen JWT in localStorage / JS-accessible memory can't
        // be replayed. Only the HttpOnly auth_token cookie is trusted.
        const token = generateToken(testUser.id);
        mockReq.headers = { authorization: `Bearer ${token}` };

        await authenticate(mockReq as AuthRequest, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'No token provided',
            statusCode: 401,
          })
        );
        expect(mockReq.userId).toBeUndefined();
      });

      it('should ignore Bearer header even when cookie is also present', async () => {
        // Stronger guard than the above: even with a valid Bearer header,
        // ONLY the cookie identity is used. Prevents confusion attacks where
        // an attacker convinces the UI to send a header alongside a cookie.
        const cookieToken = generateToken(testUser.id);
        const bearerToken = generateToken('other-user-id');

        mockReq.cookies = { auth_token: cookieToken };
        mockReq.headers = { authorization: `Bearer ${bearerToken}` };

        await authenticate(mockReq as AuthRequest, mockRes as Response, mockNext);

        expect(mockReq.userId).toBe(testUser.id);
      });

      it('should reject request with no token', async () => {
        await authenticate(mockReq as AuthRequest, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'No token provided',
            statusCode: 401,
          })
        );
      });

      it('should reject request with invalid token', async () => {
        mockReq.cookies = { auth_token: 'invalid-token' };

        await authenticate(mockReq as AuthRequest, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Invalid token',
            statusCode: 401,
          })
        );
      });

      it('should reject request for non-existent user', async () => {
        const token = generateToken('non-existent-user-id');
        mockReq.cookies = { auth_token: token };

        await authenticate(mockReq as AuthRequest, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Invalid token - user not found',
            statusCode: 401,
          })
        );
      });

      it('should reject request for deactivated user', async () => {
        await prisma.user.update({
          where: { id: testUser.id },
          data: { isActive: false },
        });

        const token = generateToken(testUser.id);
        mockReq.cookies = { auth_token: token };

        await authenticate(mockReq as AuthRequest, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Account has been deactivated',
            statusCode: 403,
          })
        );
      });
    });

    describe('requireAdmin', () => {
      it('should allow access for admin user', async () => {
        await prisma.user.update({
          where: { id: testUser.id },
          data: { isAdmin: true },
        });

        mockReq.userId = testUser.id;

        await requireAdmin(mockReq as AuthRequest, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledWith();
      });

      it('should deny access for non-admin user', async () => {
        mockReq.userId = testUser.id;

        await requireAdmin(mockReq as AuthRequest, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Admin access required',
            statusCode: 403,
          })
        );
      });

      it('should deny access for unauthenticated user', async () => {
        mockReq.userId = undefined;

        await requireAdmin(mockReq as AuthRequest, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Unauthorized',
            statusCode: 401,
          })
        );
      });

      it('should deny access for deactivated admin', async () => {
        await prisma.user.update({
          where: { id: testUser.id },
          data: { isAdmin: true, isActive: false },
        });

        mockReq.userId = testUser.id;

        await requireAdmin(mockReq as AuthRequest, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Account has been deactivated',
            statusCode: 403,
          })
        );
      });

      it('should deny access for non-existent user', async () => {
        mockReq.userId = 'non-existent-user-id';

        await requireAdmin(mockReq as AuthRequest, mockRes as Response, mockNext);

        expect(mockNext).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'User not found',
            statusCode: 404,
          })
        );
      });
    });
  });

  describe('Security Integration', () => {
    it('should complete full auth flow: hash password, generate token, verify token', async () => {
      const password = 'secure-password-123';
      const userId = 'test-user-id';

      // 1. Hash password
      const hashedPassword = await hashPassword(password);
      expect(hashedPassword).toBeDefined();

      // 2. Verify password matches
      const passwordMatch = await comparePassword(password, hashedPassword);
      expect(passwordMatch).toBe(true);

      // 3. Generate token
      const token = generateToken(userId);
      expect(token).toBeDefined();

      // 4. Verify token
      const decoded = verifyToken(token);
      expect(decoded.userId).toBe(userId);
    });

    it('should handle token expiration', async () => {
      // Note: This test would require mocking time or using a very short expiration
      // For now, we just verify the token has an expiration claim
      const userId = 'test-user-id';
      const token = generateToken(userId);

      const decoded: any = verifyToken(token);
      expect(decoded.userId).toBe(userId);
      // JWT should have 'exp' field
      expect(decoded.exp).toBeDefined();
      expect(typeof decoded.exp).toBe('number');
    });
  });
});
