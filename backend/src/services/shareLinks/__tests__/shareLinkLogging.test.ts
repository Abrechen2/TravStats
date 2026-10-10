import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { Response } from "express";
import { EventEmitter } from "node:events";

import { requestLoggerMiddleware, type AuthRequest } from "../../../middleware/requestLogger";
import { httpLogger } from "../../../utils/logger";
import { setLoggingRuntimeFlags } from "../../../utils/logging/runtimeFlags";
import { requestPathForLog } from "../../../utils/logging/requestPath";
import { generateShareToken } from "../token";

/**
 * A share token must not reach a log line (forgejo#281, design §2 T1). It
 * travels in a fragment and a POST body by design; these are the second line.
 */
describe("share tokens stay out of the logs", () => {
  afterEach(() => {
    setLoggingRuntimeFlags({ httpRequests: false, databaseQueries: false });
    jest.restoreAllMocks();
  });

  it("redacts a token-shaped path segment", () => {
    const { token } = generateShareToken();
    const path = requestPathForLog({ originalUrl: `/share/${token}/x?y=1`, url: "" });
    expect(path).toBe("/share/ts_share_[redacted]/x");
    expect(path).not.toContain(token.slice(9));
  });

  it("logs the body's keys of a public view request, never the token", () => {
    setLoggingRuntimeFlags({ httpRequests: true, databaseQueries: false });
    const lines: unknown[] = [];
    for (const level of ["info", "warn", "error"] as const) {
      jest.spyOn(httpLogger, level).mockImplementation(((entry: unknown) => {
        lines.push(entry);
      }) as never);
    }
    const { token } = generateShareToken();
    const req = {
      method: "POST",
      originalUrl: "/api/v1/public/share-links/view",
      url: "/view",
      ip: "198.51.100.7",
      body: { token },
      get: () => undefined,
    } as unknown as AuthRequest;
    const res = Object.assign(new EventEmitter(), { statusCode: 404 }) as unknown as Response;
    requestLoggerMiddleware(req, res, () => undefined);
    (res as unknown as EventEmitter).emit("finish");
    expect(lines).toHaveLength(1);
    const logged = JSON.stringify(lines);
    expect(logged).toContain('"bodyKeys":["token"]');
    expect(logged).not.toContain(token);
  });
});
