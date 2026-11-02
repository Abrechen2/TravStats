/**
 * Authentication for remote guests (spec 2026-10-17 §6.5). It is a different door from
 * `authenticate`, not an extension of it: a guest is never a user. This middleware reads ONLY the
 * `ts_guest` cookie or a `ts_gpat_` bearer, so a user JWT or user PAT is refused here, and
 * `authenticate` reads neither of them, so a guest credential is refused everywhere else. It sets
 * `req.guest` and never `req.userId`.
 */
import type { Request, RequestHandler, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { AppError } from "./errorHandler";
import { skipOutsideProduction } from "./rateLimit";
import { getCookieSecure } from "../utils/session";
import {
  GUEST_COOKIE,
  PAT_PREFIX,
  authenticateCredential,
  type GuestPrincipal,
} from "../services/travplan/guests/sessions";
import { assertTravPlanOffered } from "../services/travplan/availability";
import { assertEnabled } from "../services/travplan/store";

export interface GuestRequest extends Request {
  guest?: GuestPrincipal;
}

/** A custom header a cross-site form or image cannot send: the cookie alone does not write. */
export const GUEST_CSRF_HEADER = "x-travstats-guest";
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export const authenticateGuest: RequestHandler = (req: GuestRequest, res, next) => {
  void (async () => {
    // The guest door is closed while planning is off, like every plan endpoint.
    await assertTravPlanOffered();
    await assertEnabled();
    const header = req.headers.authorization;
    let principal: GuestPrincipal;
    if (header !== undefined) {
      const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
      // Any other credential in the header (a user PAT, a JWT) is not ours: refused, not ignored.
      if (!match || !match[1].startsWith(PAT_PREFIX))
        throw new AppError("Guest sign-in required", 401, "PLAN_GUEST_REQUIRED");
      principal = await authenticateCredential(match[1], "pat");
    } else {
      const cookie = req.cookies?.[GUEST_COOKIE] as string | undefined;
      principal = await authenticateCredential(cookie, "session");
      if (!SAFE.has(req.method) && req.get(GUEST_CSRF_HEADER) !== "1")
        throw new AppError("Guest request is missing its marker header", 403, "PLAN_GUEST_CSRF");
    }
    req.guest = principal;
    // The server slid the session's expiry; the browser's cookie must follow or it lapses on
    // the original date while the member is still active.
    if (principal.renewedUntil)
      res.cookie(GUEST_COOKIE, req.cookies?.[GUEST_COOKIE], {
        httpOnly: true,
        sameSite: "lax",
        path: "/api/v1/guest",
        secure: getCookieSecure(req),
        expires: principal.renewedUntil,
      });
  })().then(() => next(), next);
};

const tooMany = (what: string) => (_req: Request, res: Response) => {
  res.status(429).json({ error: `Too many ${what}, slow down`, code: "PLAN_GUEST_RATE_LIMITED" });
};
// Keyed by the member, so one guest cannot spend another's allowance, and one guest cannot
// escape the limit by changing credential or address.
const memberKey = (req: Request): string =>
  `guest:${(req as GuestRequest).guest?.memberId ?? "none"}`;

export const GUEST_WRITES_PER_MINUTE = 120;
export const GUEST_READS_PER_MINUTE = 600;
const writes = rateLimit({
  windowMs: 60_000,
  max: GUEST_WRITES_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: memberKey,
  handler: tooMany("writes"),
});
const reads = rateLimit({
  windowMs: 60_000,
  max: GUEST_READS_PER_MINUTE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: memberKey,
  handler: tooMany("requests"),
});
export const guestLimiter: RequestHandler = (req, res, next) =>
  (SAFE.has(req.method) ? reads : writes)(req, res, next);

/** The unauthenticated join endpoints and the vouch: per address (masked), few and slow. */
export const joinLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `join:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`,
  // The pre-auth bypass the other unauthenticated limiters share; production never sets either value.
  skip: skipOutsideProduction,
  handler: tooMany("join attempts"),
});

/**
 * Redeeming a claim code needs no credential, so it is the one place a code can be guessed:
 * few attempts per address (masked to /56 for IPv6). 30^10 codes live five minutes each.
 */
export const claimLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `claim:${req.ip ? ipKeyGenerator(req.ip) : "unknown"}`,
  skip: skipOutsideProduction,
  handler: tooMany("pairing attempts"),
});

export const assertPathPlan =
  (param = "planId"): RequestHandler =>
  (req: GuestRequest, _res, next) => {
    // The plan in the path must be the plan of the credential; any other is a plan that is not there.
    if (req.params[param] !== req.guest?.planId)
      return next(new AppError("Plan not found", 404, "PLAN_NOT_FOUND"));
    next();
  };
