import { EventEmitter } from "events";
import type { Request, Response } from "express";

const warn = jest.fn();
const info = jest.fn();
jest.mock("../../utils/logger", () => ({
  httpLogger: { info: (...a: unknown[]) => info(...a), warn: (...a: unknown[]) => warn(...a) },
  dbLogger: { warn: jest.fn() },
  generateRequestId: () => "req-test",
}));
// HTTP request logging is OFF, as on prod.
jest.mock("../../utils/logging/runtimeFlags", () => ({
  getLoggingRuntimeFlags: () => ({ httpRequests: false }),
}));

import { requestLoggerMiddleware } from "../requestLogger";

/**
 * Perf audit 2026-11, item 4: with the httpRequests flag off (prod) there was
 * no latency record at all. A request over 1 s is logged anyway.
 */
function run(durationMs: number): void {
  const now = jest.spyOn(Date, "now");
  now.mockReturnValueOnce(1_000_000);
  const req = {
    method: "GET",
    originalUrl: "/api/v1/stats/wrapped/2025?x=secret",
    url: "/wrapped/2025",
    baseUrl: "/api/v1/stats",
    route: { path: "/wrapped/:year" },
    path: "/wrapped/2025",
    get: () => undefined,
    ip: "127.0.0.1",
  } as unknown as Request;
  const res = Object.assign(new EventEmitter(), { statusCode: 200 }) as unknown as Response;
  requestLoggerMiddleware(req, res, jest.fn());
  now.mockReturnValue(1_000_000 + durationMs);
  res.emit("finish");
  now.mockRestore();
}

describe("slow requests are logged even with HTTP logging off", () => {
  it("warns about a 1.5 s request, keyed by route pattern, without the query string", () => {
    run(1500);
    const line = warn.mock.calls.find(([a]) => a?.operation === "slow_request")?.[0];
    expect(line).toBeDefined();
    expect(line.context.route).toBe("GET /api/v1/stats/wrapped/:year");
    expect(JSON.stringify(line)).not.toContain("secret");
    expect(info).not.toHaveBeenCalled();
  });

  it("stays quiet for a fast request", () => {
    warn.mockClear();
    run(200);
    expect(warn).not.toHaveBeenCalled();
  });
});
