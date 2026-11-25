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

import { headerForLog, requestLoggerMiddleware } from "../requestLogger";

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

  it("logs X-TravStats-Client and X-TravStats-Tool, sanitised and cut", () => {
    info.mockClear();
    const headers: Record<string, string> = {
      "x-travstats-client": "travstats-mcp/0.2.0",
      "x-travstats-tool": `add_flight\n{"forged":"line"}${"x".repeat(200)}`,
    };
    const req = {
      method: "POST",
      originalUrl: "/api/v1/flights",
      url: "/api/v1/flights",
      baseUrl: "",
      path: "/api/v1/flights",
      get: (h: string) => headers[h.toLowerCase()],
      ip: "127.0.0.1",
    } as unknown as Request;
    const res = Object.assign(new EventEmitter(), { statusCode: 201 }) as unknown as Response;
    requestLoggerMiddleware(req, res, jest.fn());
    res.emit("finish");
    const ctx = info.mock.calls.find(([a]) => a?.operation === "http_request")?.[0].context;
    expect(ctx.clientName).toBe("travstats-mcp/0.2.0");
    expect(ctx.clientTool).not.toMatch(/[\n\r]/);
    expect(ctx.clientTool.length).toBeLessThanOrEqual(64);
    expect(headerForLog(undefined)).toBeUndefined();
    expect(headerForLog("  ")).toBeUndefined();
  });
});
