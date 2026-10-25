import type { Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import { travTrackImportKey } from "./travTrackImportLimiter";

/**
 * Rate limits of OwnTracks and Overland (TravTrack plan E9). Its own file
 * because `rateLimit.ts` sits at the 800-line limit. Every address key goes
 * through `ipKeyGenerator` (/56 for IPv6), as express-rate-limit 8 demands
 * (`rateLimit.ipv6.test.ts`).
 *
 *   - per token: one phone. OwnTracks in move mode posts every few seconds at
 *     most; Overland sends batches. 60 a minute is headroom over both.
 *   - per account: across every token it holds, so ten tokens are not ten
 *     times the bucket.
 *   - per address, failures only: a request whose token does not verify. A
 *     256-bit token cannot be guessed at any rate; this bounds the database
 *     work a stranger can cause. Only a failing request is counted AND only a
 *     failing request is refused by it (`ingestTokenAuth`), so a stranger
 *     sharing an address with a phone — one home connection, a reverse proxy —
 *     cannot lock the phone out.
 *   - creating tokens: per account, like the file imports.
 */

export const INGEST_PER_TOKEN_PER_MINUTE = 60;
export const INGEST_PER_ACCOUNT_PER_MINUTE = 180;
export const INGEST_AUTH_FAILURES_PER_WINDOW = 30;
export const INGEST_TOKEN_CREATES_PER_WINDOW = 20;

const limited = { error: "Too many requests, please try again later", code: "RATE_LIMITED" };

type IngestRequest = Request & { ingestToken?: { tokenId: string; userId: string } };

/** Mount AFTER `ingestTokenAuth`. */
export const ingestTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: INGEST_PER_TOKEN_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  message: limited,
  keyGenerator: (req: Request) => `ingest-token:${(req as IngestRequest).ingestToken?.tokenId}`,
});

/** Mount AFTER `ingestTokenAuth`. */
export const ingestAccountLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: INGEST_PER_ACCOUNT_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  message: limited,
  keyGenerator: (req: Request) => `ingest-user:${(req as IngestRequest).ingestToken?.userId}`,
});

/** Called by `ingestTokenAuth` on a failed verification only. */
export const ingestAuthFailureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: INGEST_AUTH_FAILURES_PER_WINDOW,
  standardHeaders: true,
  legacyHeaders: false,
  message: limited,
  keyGenerator: (req: Request) => `ingest-fail:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`,
});

/** Creating ingest tokens, per account. Mount AFTER `authenticate`. */
export const ingestTokenCreateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: INGEST_TOKEN_CREATES_PER_WINDOW,
  standardHeaders: true,
  legacyHeaders: false,
  message: limited,
  keyGenerator: travTrackImportKey,
});
