import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { Response, NextFunction } from 'express';

jest.mock('../utils/logger', () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
  securityLogger: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('../db', () => ({
  prisma: {},
}));

jest.mock('../utils/jwtSecret', () => ({
  JWT_SECRET: 'test-secret',
}));

import { requireWriteScope, type AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

describe('requireWriteScope middleware', () => {
  let res: Partial<Response>;
  let next: jest.Mock;

  beforeEach(() => {
    res = {};
    next = jest.fn();
  });

  const mkReq = (overrides: Partial<AuthRequest>): AuthRequest =>
    ({
      method: 'POST',
      url: '/api/v1/test',
      userId: 'user-1',
      ...overrides,
    }) as AuthRequest;

  describe('cookie session (no PAT)', () => {
    it('passes through on POST when apiToken is absent', () => {
      const req = mkReq({ method: 'POST', apiToken: undefined });
      requireWriteScope(req, res as Response, next as unknown as NextFunction);
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    it('passes through on DELETE when apiToken is absent', () => {
      const req = mkReq({ method: 'DELETE', apiToken: undefined });
      requireWriteScope(req, res as Response, next as unknown as NextFunction);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('PAT with read scope', () => {
    const readToken = { id: 'tok-read', scope: 'read' as const };

    it('passes through on GET', () => {
      const req = mkReq({ method: 'GET', apiToken: readToken });
      requireWriteScope(req, res as Response, next as unknown as NextFunction);
      expect(next).toHaveBeenCalledWith();
    });

    it('passes through on HEAD', () => {
      const req = mkReq({ method: 'HEAD', apiToken: readToken });
      requireWriteScope(req, res as Response, next as unknown as NextFunction);
      expect(next).toHaveBeenCalledWith();
    });

    it('passes through on OPTIONS (CORS preflight)', () => {
      const req = mkReq({ method: 'OPTIONS', apiToken: readToken });
      requireWriteScope(req, res as Response, next as unknown as NextFunction);
      expect(next).toHaveBeenCalledWith();
    });

    it('rejects POST with 403 AppError', () => {
      const req = mkReq({ method: 'POST', apiToken: readToken });
      requireWriteScope(req, res as Response, next as unknown as NextFunction);
      expect(next).toHaveBeenCalledTimes(1);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(403);
      expect((err as AppError).message).toMatch(/scope/i);
    });

    it.each(['PUT', 'PATCH', 'DELETE'])('rejects %s with 403 AppError', (method) => {
      const req = mkReq({ method, apiToken: readToken });
      requireWriteScope(req, res as Response, next as unknown as NextFunction);
      const err = next.mock.calls[0][0];
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(403);
    });
  });

  describe('PAT with write scope', () => {
    const writeToken = { id: 'tok-write', scope: 'write' as const };

    it.each(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'])(
      'passes through on %s',
      (method) => {
        const req = mkReq({ method, apiToken: writeToken });
        requireWriteScope(req, res as Response, next as unknown as NextFunction);
        expect(next).toHaveBeenCalledWith();
      }
    );
  });

  describe('PAT with admin scope', () => {
    const adminToken = { id: 'tok-admin', scope: 'admin' as const };

    it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])(
      'passes through on %s (admin implies write)',
      (method) => {
        const req = mkReq({ method, apiToken: adminToken });
        requireWriteScope(req, res as Response, next as unknown as NextFunction);
        expect(next).toHaveBeenCalledWith();
      }
    );
  });
});
