/**
 * Admin step-up for a paired Companion (spec 2026-11-02 §6). A device token is `write` scope, so
 * it cannot call the admin surface; for exactly three federation calls the admin may instead
 * re-prove the password (and the TOTP when two-factor is on) in the request body. Nothing is
 * remembered: every call proves it again, and no admin-scope token ever lives on a phone.
 *
 * The password and the code are never logged. Wrong attempts are counted per account, because
 * the login lockout is an address-keyed limiter (`authLimiter`) and a stolen device token must
 * not get a password guess budget of its own per address.
 */
import type { NextFunction, Response } from "express";

import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { AuthRequest } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimit";
import { comparePassword } from "../../utils/password";
import { decryptSecret, verifyCode } from "../twoFactor/totpService";
import logger from "../../utils/logger";

export const STEP_UP_MAX_FAILURES = 5;
export const STEP_UP_WINDOW_MS = 15 * 60 * 1000;

/** The only calls that accept a step-up (path relative to the admin mount). */
const STEP_UP_PATHS = new Set([
  "/federation/peers",
  "/federation/peers/verify",
  "/federation/peers/suspend",
]);

const failures = new Map<string, { count: number; first: number }>();

export function resetStepUpFailures(): void {
  failures.clear();
}

function isLocked(userId: string, now = Date.now()): boolean {
  const entry = failures.get(userId);
  if (!entry) return false;
  if (now - entry.first > STEP_UP_WINDOW_MS) {
    failures.delete(userId);
    return false;
  }
  return entry.count >= STEP_UP_MAX_FAILURES;
}

function countFailure(userId: string, now = Date.now()): void {
  const entry = failures.get(userId);
  if (!entry || now - entry.first > STEP_UP_WINDOW_MS)
    failures.set(userId, { count: 1, first: now });
  else entry.count += 1;
  logger.warn({ operation: "admin_step_up_failed", userId, attempts: failures.get(userId)?.count });
}

const failed = () => new AppError("Step-up refused", 403, "ADMIN_STEP_UP_FAILED");

async function passwordMatches(password: string, hash: string): Promise<boolean> {
  // A passkey-only account has no bcrypt hash; there is nothing to compare against.
  if (!/^\$2[aby]\$/.test(hash)) return false;
  try {
    return await comparePassword(password, hash);
  } catch {
    return false;
  }
}

/** The step-up fields of a body, or null when the request does not attempt one. */
function stepUpFields(body: unknown): { password: string; totp?: string } | null {
  if (!body || typeof body !== "object" || !("password" in body)) return null;
  const { password, totp } = body as { password: unknown; totp?: unknown };
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) return null;
  if (totp !== undefined && typeof totp !== "string") return null;
  return { password, totp };
}

async function verifyStepUp(req: AuthRequest, fields: { password: string; totp?: string }) {
  const userId = req.userId!;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isAdmin: true,
      isActive: true,
      passwordHash: true,
      twoFactorEnabledAt: true,
      twoFactorSecret: true,
    },
  });
  // Admin status first: a non-admin learns nothing about the password check.
  if (!user || !user.isActive || !user.isAdmin) throw new AppError("Admin access required", 403);
  if (isLocked(userId)) {
    throw new AppError("Too many step-up attempts, try again later", 429, "ADMIN_STEP_UP_LOCKED");
  }
  if (!(await passwordMatches(fields.password, user.passwordHash))) {
    countFailure(userId);
    throw failed();
  }
  if (user.twoFactorEnabledAt) {
    if (!fields.totp) {
      throw new AppError("A second-factor code is required", 403, "ADMIN_STEP_UP_TOTP_REQUIRED");
    }
    const ok = user.twoFactorSecret
      ? verifyCode(decryptSecret(user.twoFactorSecret), fields.totp)
      : false;
    if (!ok) {
      countFailure(userId);
      throw failed();
    }
  }
  failures.delete(userId);
}

/**
 * Mounted on the admin router BEFORE `requireAdmin`. It acts only for a write-scope token on
 * `POST` to one of the three paths above whose body carries a `password`; everything else falls
 * through to the ordinary guards untouched. On success it marks the request and strips
 * `password`/`totp` so the routes' strict schemas see the body they always saw.
 */
export function adminStepUpGate(req: AuthRequest, res: Response, next: NextFunction): void {
  const path = req.path.replace(/\/+$/, "");
  const fields = stepUpFields(req.body);
  if (
    req.method !== "POST" ||
    !req.userId ||
    req.apiToken?.scope !== "write" ||
    !STEP_UP_PATHS.has(path) ||
    !fields
  ) {
    next();
    return;
  }
  // The same address-keyed limiter the login uses; every attempt counts.
  authLimiter(req, res, (limited?: unknown) => {
    if (limited) {
      next(limited);
      return;
    }
    verifyStepUp(req, fields)
      .then(() => {
        const { password: _p, totp: _t, ...rest } = req.body as Record<string, unknown>;
        req.body = rest;
        req.adminStepUpVerified = true;
        next();
      })
      .catch(next);
  });
}
