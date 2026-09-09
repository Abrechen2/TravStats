import crypto from "crypto";

import type { CookieOptions, Request, Response } from "express";

import { prisma } from "../db";

import { AppError } from "../middleware/errorHandler";
import { generateToken } from "./jwt";
import { securityLogger } from "./logger";

const cookieMaxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 days
const changeTokenMaxAgeMs = 10 * 60 * 1000; // 10 minutes

/**
 * Determine whether the auth cookie must carry `secure`.
 *
 * `COOKIE_SECURE` wins when set. Otherwise secure cookies are used only in
 * production AND behind HTTPS — `req.protocol` is trustworthy because Express
 * is started with trust proxy.
 */
export function getCookieSecure(req: Request): boolean {
  // NOTE the polarity: any value other than the literal "false" means secure.
  // Kept exactly as it was when this moved out of routes/auth.ts — flipping it
  // to `=== "true"` would silently turn COOKIE_SECURE=1 into an insecure cookie.
  if (process.env.COOKIE_SECURE !== undefined) {
    return process.env.COOKIE_SECURE !== "false";
  }
  if (process.env.NODE_ENV === "production") {
    return req.protocol === "https" || req.get("x-forwarded-proto") === "https";
  }
  return false;
}

export const getAuthCookieOptions = (req: Request): CookieOptions => ({
  httpOnly: true, // Prevents JavaScript access (XSS protection)
  secure: getCookieSecure(req),
  sameSite: "strict",
  maxAge: cookieMaxAgeMs,
  path: "/",
});

/** The little a caller must know about the account to be given a session. */
export interface SessionSubject {
  id: string;
  isActive: boolean;
  /** The counter the minted token is stamped with — see utils/jwt.ts. */
  sessionEpoch: number;
}

/**
 * The ONE place a proven identity becomes a session cookie.
 *
 * Every route that turns "this person is who they say" into `auth_token` goes
 * through here — password login, two-factor verification, passkey assertion,
 * registration and first-boot setup. That is the point of the function: the
 * deactivation check is a property of *issuing a session*, not of one route.
 *
 * Forgejo #31 is what happens when it is not: `/auth/login` answered a
 * deactivated account with HTTP 200 and a fresh `auth_token`, and only the
 * NEXT request was refused by `authenticate`. The lock held, but the door
 * still handed out keys — and the passkey and two-factor routes minted their
 * own sessions from their own `res.cookie` calls, so fixing the login handler
 * alone would have left two other ways in.
 *
 * 403, not 401: the credentials WERE right, and `authenticate` already answers
 * 403 for the same condition. Saying 401 here would describe a different
 * failure than the one that occurred, and would send the user to reset a
 * password that is not the problem.
 */
export function issueAuthCookie(req: Request, res: Response, user: SessionSubject): void {
  if (!user.isActive) {
    securityLogger.warn({
      operation: "security_event",
      message: "Session refused: account deactivated",
      context: { userId: user.id, path: req.path },
    });
    throw new AppError("This account has been deactivated", 403);
  }

  res.cookie("auth_token", generateToken(user.id, user.sessionEpoch), getAuthCookieOptions(req));
}

/**
 * The ONE place a due password change becomes a challenge cookie.
 *
 * Sibling of `issueAuthCookie`, and here for the same reason: two login paths
 * have to answer the same question, and until 2026-09-09 only one of them did.
 * `/auth/login` minted this cookie inline; `/auth/2fa/verify` never asked, so a
 * correct TOTP handed out a full session and the administrator's forced
 * password change simply did not happen for any account with two-factor on
 * (audit finding AUD-005). `routes/auth/passkeys.ts` got it right and says so
 * in a comment — three doors, one question, and it must not depend on which
 * door you use.
 *
 * The token travels in an HttpOnly cookie and never in the response body: it is
 * a credential for `POST /auth/force-change-password`, and a body could be read
 * by injected script.
 */
export async function issuePasswordChangeChallenge(
  req: Request,
  res: Response,
  userId: string
): Promise<void> {
  const plainChangeToken = crypto.randomBytes(32).toString("hex");
  const hashedChangeToken = crypto.createHash("sha256").update(plainChangeToken).digest("hex");

  await prisma.user.update({
    where: { id: userId },
    data: {
      changeToken: hashedChangeToken,
      changeTokenExpiry: new Date(Date.now() + changeTokenMaxAgeMs),
    },
  });

  res.cookie("change_token", plainChangeToken, {
    httpOnly: true,
    secure: getCookieSecure(req),
    sameSite: "strict",
    maxAge: changeTokenMaxAgeMs,
    path: "/",
  });
}
