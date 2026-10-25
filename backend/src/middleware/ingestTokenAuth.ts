import type { NextFunction, Request, Response } from "express";

import {
  verifyIngestToken,
  type IngestTokenKind,
  type VerifiedIngestToken,
} from "../services/travtrack/sources/ingestTokens";
import { securityLogger } from "../utils/logger";
import { AppError } from "./errorHandler";
import {
  INGEST_AUTH_FAILURES_PER_WINDOW,
  ingestAuthFailureLimiter,
  ingestFailureKey,
} from "./ingestSourceLimits";

/**
 * Authentication of the OwnTracks and Overland ingest paths (TravTrack plan
 * E9, review focus 25). Each app has exactly one way to present its token:
 *
 *   - OwnTracks: HTTP Basic, the token as the password (the username is free).
 *   - Overland:  `Authorization: Bearer <token>`.
 *
 * Anything else is 401 `INGEST_TOKEN_INVALID` — the other app's scheme, the
 * other app's token, and a token anywhere in the URL, even beside a valid
 * header: a URL lands in proxy logs and browser history, so a credential
 * there is refused rather than tolerated.
 *
 * Sets `req.ingestToken` and `req.userId`; never `req.apiToken` — the token
 * opens these two paths and nothing else. Nothing here logs the token, a
 * digest of it, or the header; rejections are only counted.
 *
 * An address over its failure bound (`ingestSourceLimits.ts`) is refused
 * with 429 before the header is read or any token looked up.
 */

export type IngestTokenRequest = Request & {
  ingestToken?: VerifiedIngestToken;
  userId?: string;
};

/** Query parameters a client could put a credential in. */
const URL_CREDENTIALS = ["token", "access_token", "api_key", "apikey", "key", "password"];

function credentialOf(kind: IngestTokenKind, header: string | undefined): string | null {
  const value = header?.trim() ?? "";
  if (kind === "overland") {
    const bearer = /^Bearer\s+(\S+)$/i.exec(value);
    return bearer ? bearer[1] : null;
  }
  const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!basic) return null;
  const decoded = Buffer.from(basic[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon === -1 ? null : decoded.slice(colon + 1);
}

const invalid = () =>
  new AppError("The ingest token is missing or invalid", 401, "INGEST_TOKEN_INVALID");

const limited = () =>
  new AppError("Too many requests, please try again later", 429, "RATE_LIMITED");

/**
 * Rejections are counted, not logged one line each: a stranger hammering the
 * path would otherwise write the log for us. The counts go out as one
 * security line at most once a minute, on the next rejection after it.
 */
const SUMMARY_EVERY_MS = 60_000;
let counts: Record<string, number> = {};
let lastSummaryAt = 0;

function noteRejection(kind: IngestTokenKind, reason: string): void {
  const key = `${kind}.${reason}`;
  counts = { ...counts, [key]: (counts[key] ?? 0) + 1 };
  const now = Date.now();
  if (now - lastSummaryAt < SUMMARY_EVERY_MS) return;
  securityLogger.warn({
    operation: "security_event",
    message: "Ingest tokens rejected",
    context: { eventType: "auth_failure", counts, sinceMs: lastSummaryAt || null },
  });
  counts = {};
  lastSummaryAt = now;
}

function refuse(
  req: Request,
  res: Response,
  next: NextFunction,
  kind: IngestTokenKind,
  reason: string
) {
  noteRejection(kind, reason);
  if (kind === "owntracks") res.setHeader("WWW-Authenticate", 'Basic realm="TravTrack"');
  // Counted; refused with 429 once this address has failed too often.
  ingestAuthFailureLimiter(req, res, () => next(invalid()));
}

/** Whether this address has spent its failures: then nothing is looked up at all. */
async function overFailureBound(req: Request): Promise<boolean> {
  const info = await ingestAuthFailureLimiter.getKey(ingestFailureKey(req));
  return (info?.totalHits ?? 0) >= INGEST_AUTH_FAILURES_PER_WINDOW;
}

export function ingestTokenAuth(kind: IngestTokenKind) {
  return (req: IngestTokenRequest, res: Response, next: NextFunction): void => {
    void (async () => {
      if (await overFailureBound(req)) {
        noteRejection(kind, "rate_limited");
        return next(limited());
      }
      const inUrl = Object.keys(req.query ?? {}).some((k) =>
        URL_CREDENTIALS.includes(k.toLowerCase())
      );
      if (inUrl) return refuse(req, res, next, kind, "token_in_url");
      const token = credentialOf(kind, req.headers.authorization);
      if (token === null) return refuse(req, res, next, kind, "wrong_scheme");
      const verified = await verifyIngestToken(token, kind);
      if (!verified) return refuse(req, res, next, kind, "unknown_token");
      req.ingestToken = verified;
      req.userId = verified.userId;
      next();
    })().catch(next);
  };
}
