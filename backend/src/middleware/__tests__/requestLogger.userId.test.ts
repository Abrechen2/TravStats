import { EventEmitter } from "events";
import type { Request, Response } from "express";

const info = jest.fn();
jest.mock("../../utils/logger", () => ({
  httpLogger: { info: (...a: unknown[]) => info(...a), warn: jest.fn(), error: jest.fn() },
  generateRequestId: () => "req-test",
}));
jest.mock("../../utils/logging/runtimeFlags", () => ({
  getLoggingRuntimeFlags: () => ({ httpRequests: true }),
}));

import { requestLoggerMiddleware } from "../requestLogger";

describe("requestLoggerMiddleware", () => {
  // `authenticate` sets `req.userId`; the logger read `req.user?.id`, which is
  // never populated, so no request line named its account and a user's own
  // diagnostic package could not find them.
  it("records the authenticated account's id on the request line", () => {
    const req = {
      method: "GET",
      originalUrl: "/api/v1/trips",
      url: "/api/v1/trips",
      baseUrl: "",
      path: "/api/v1/trips",
      get: () => undefined,
      ip: "127.0.0.1",
    } as unknown as Request & { userId?: string; requestId?: string };
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      setHeader: jest.fn(),
    }) as unknown as Response;
    requestLoggerMiddleware(req, res, jest.fn());
    req.userId = "user-123";
    res.emit("finish");

    const call = info.mock.calls.find(([arg]) => arg?.operation === "http_request");
    expect(call?.[0].context.userId).toBe("user-123");
  });
});
