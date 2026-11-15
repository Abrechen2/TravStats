import { prisma } from "../../db";
import logger from "../../utils/logger";

/**
 * Per-ACCOUNT login backoff (forgejo#415 N3), on top of the per-IP limiter in
 * middleware/rateLimit.ts: an attacker rotating addresses still meets one
 * counter per username.
 *
 * Bounded on purpose. After LOGIN_LOCK_THRESHOLD consecutive failures the
 * account refuses logins for a window that doubles per further failure up to
 * LOGIN_LOCK_MAX_MS; attempts made while locked do not extend it, and failures
 * older than LOGIN_FAILURE_WINDOW_MS are forgotten. An attacker can therefore
 * delay a real user by at most the maximum window, never lock them out.
 */
export const LOGIN_LOCK_THRESHOLD = 10;
export const LOGIN_LOCK_BASE_MS = 30_000;
export const LOGIN_LOCK_MAX_MS = 15 * 60_000;
export const LOGIN_FAILURE_WINDOW_MS = 60 * 60_000;
const USERNAME_KEY_MAX = 128;

/** Case-folded and length-capped: `Admin` and `admin` share one counter. */
export function throttleKey(username: string): string {
  return username.trim().toLowerCase().slice(0, USERNAME_KEY_MAX);
}

export function lockDurationMs(failures: number): number {
  if (failures < LOGIN_LOCK_THRESHOLD) return 0;
  const doublings = failures - LOGIN_LOCK_THRESHOLD;
  // Cap the exponent first: 2 ** n overflows to Infinity long before it matters.
  if (doublings >= 20) return LOGIN_LOCK_MAX_MS;
  return Math.min(LOGIN_LOCK_BASE_MS * 2 ** doublings, LOGIN_LOCK_MAX_MS);
}

/** Seconds the account is still locked for, or 0 when a login may be tried. */
export async function loginLockRemainingSeconds(username: string): Promise<number> {
  const row = await prisma.loginThrottle.findUnique({
    where: { usernameKey: throttleKey(username) },
    select: { lockedUntil: true },
  });
  if (!row?.lockedUntil) return 0;
  const remainingMs = row.lockedUntil.getTime() - Date.now();
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

/**
 * Count one failed login. One statement, so concurrent guesses cannot read the
 * same value and undercount. Returns the failure count after this attempt.
 */
export async function recordLoginFailure(
  username: string,
  context: { ip?: string; reason: string }
): Promise<number> {
  const key = throttleKey(username);
  const now = new Date();
  const windowStart = new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MS);
  const rows = await prisma.$queryRaw<{ failures: number }[]>`
    INSERT INTO login_throttles (username_key, failures, last_failure_at)
    VALUES (${key}, 1, ${now})
    ON CONFLICT (username_key) DO UPDATE SET
      failures = CASE WHEN login_throttles.last_failure_at < ${windowStart}
                      THEN 1 ELSE login_throttles.failures + 1 END,
      last_failure_at = ${now}
    RETURNING failures`;
  const failures = Number(rows[0]?.failures ?? 1);

  const lockMs = lockDurationMs(failures);
  if (lockMs > 0) {
    await prisma.loginThrottle.update({
      where: { usernameKey: key },
      data: { lockedUntil: new Date(now.getTime() + lockMs) },
    });
  } else if (failures === 1) {
    // A new window starts: drop rows whose window is long over, so the table
    // does not grow with every username anyone ever typed.
    await prisma.loginThrottle.deleteMany({
      where: {
        lastFailureAt: { lt: windowStart },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
    });
  }

  // Username, never the password. The IP is what an operator greps for.
  logger.warn({
    operation: "auth_login_failed",
    username: key,
    reason: context.reason,
    failures,
    locked: lockMs > 0,
    lockSeconds: Math.round(lockMs / 1000),
    ip: context.ip,
  });
  return failures;
}

/** A successful login ends the streak. */
export async function clearLoginFailures(username: string): Promise<void> {
  await prisma.loginThrottle.deleteMany({ where: { usernameKey: throttleKey(username) } });
}
