import type { Request, Response } from "express";
import { zoneSelfCheckResult } from "../shared/time/zoneOf";
import { appVersion } from "../utils/version";

/**
 * Health check — mounted at both `/health` (legacy, used by the Dockerfile
 * HEALTHCHECK and the nginx upstream probe) and `/api/v1/health` (versioned,
 * matches the public-API URL convention documented for external callers).
 *
 * `degraded` when the boot self-check found the time zone lookup broken
 * (shared/time/zoneOf.ts). Still a 200: the process serves requests and a
 * restart would not fix a broken dependency, but a probe that reads the body
 * sees it, instead of the server reading every local time as UTC in silence.
 */
export function healthHandler(_req: Request, res: Response): void {
  const timezone = zoneSelfCheckResult();
  const timezoneLookup = timezone === null ? "pending" : timezone.ok ? "ok" : "failed";
  res.json({
    status: timezoneLookup === "failed" ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    version: appVersion,
    checks: { timezoneLookup },
  });
}
