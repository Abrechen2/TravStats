import { describe, it, expect, jest } from '@jest/globals';
import { Request, Response, NextFunction } from 'express';
import { errorHandler, AppError } from '../middleware/errorHandler';

/**
 * These run against the REAL logger, deliberately — no `jest.mock` of
 * `utils/logger` anywhere in this file.
 *
 * `middleware.test.ts` mocks the logger with plain `jest.fn()`s, which is right
 * for asserting WHICH level an entry goes to. But a plain mock has no `this`
 * dependency, so it cannot catch a logger method that has been detached from
 * its instance. Pino's methods do rely on `this`: choosing the level with
 * `const log = cond ? logger.error : logger.warn; log(entry)` throws
 * "Cannot read properties of undefined (reading Symbol(pino.msgPrefix))" on
 * every single call — while the mocked suite stays green. That exact mistake
 * was made and shipped into a full-suite run during #245; 107 tests failed and
 * the unit tests did not budge.
 *
 * So: one cheap smoke test per level, against the real thing.
 */
describe('errorHandler logs through a bound logger (#245 regression)', () => {
  const makeReq = (): Partial<Request> => ({
    method: 'GET',
    url: '/api/test',
    path: '/api/test',
    query: {},
    ip: '127.0.0.1',
    get: jest.fn(() => 'test-user-agent') as unknown as Request['get'],
  });

  const makeRes = (): Partial<Response> => {
    const json = jest.fn();
    return { status: jest.fn().mockReturnValue({ json }) as unknown as Response['status'], json };
  };

  it('does not throw on a 4xx (the warn path)', async () => {
    await expect(
      errorHandler(
        new AppError('Not authenticated', 401),
        makeReq() as Request,
        makeRes() as Response,
        jest.fn() as NextFunction
      )
    ).resolves.not.toThrow();
  });

  it('does not throw on a 5xx (the error path)', async () => {
    await expect(
      errorHandler(
        new AppError('Internal error', 500),
        makeReq() as Request,
        makeRes() as Response,
        jest.fn() as NextFunction
      )
    ).resolves.not.toThrow();
  });
});
