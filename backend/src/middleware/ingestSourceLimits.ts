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
 *     work and log volume a stranger can cause. Only failures are counted
 *     and only failures are refused by it: a well-formed token is always
 *     verified (one indexed keyed-hash lookup), so a phone sharing an address
 *     with a client that keeps failing — one home connection, a reverse
 *     proxy — is never locked out. A request with no usable credential is
 *     refused before any lookup once the address is over the bound
 *     (`ingestTokenAuth`). Past the hard cap (10× the bound), only tokens
 *     that verified within the last day are still looked up, so a flood of
 *     well-formed fakes costs no database work either; a valid token never
 *     seen before waits out the window there.
 *   - creating tokens: per account, like the file imports.
 */

export const INGEST_PER_TOKEN_PER_MINUTE = 60;
export const INGEST_PER_ACCOUNT_PER_MINUTE = 180;
export const INGEST_AUTH_FAILURES_PER_WINDOW = 30;
/**
 * Past this many failures in the window, an address gets no lookup at all for
 * a token that has not verified recently (`isKnownGoodIngestToken`): a flood
 * of well-formed fakes costs no database work, a known phone still passes.
 */
export const INGEST_AUTH_HARD_CAP = 10 * INGEST_AUTH_FAILURES_PER_WINDOW;
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

/** The failure bucket of a request's address. */
export const ingestFailureKey = (req: Request): string =>
  `ingest-fail:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`;

/** Counted by `ingestTokenAuth` on a failed verification only; read before every one. */
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
