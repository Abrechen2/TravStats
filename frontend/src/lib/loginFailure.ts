/**
 * What to tell the reader when signing in did not work.
 *
 * The login form used to print the server's own `error` string. That string is
 * English prose written for a log — so a German page answered a mistyped
 * password with "Invalid credentials", and a rate-limited one with "Too many
 * authentication attempts, please try again later" (forgejo#88, findings 3 and
 * 4). Worse, the 429 body was not JSON at all, so `data.error` was undefined
 * and the form fell back to "Anmeldung fehlgeschlagen" — naming the wrong
 * cause entirely, since the password may have been right.
 *
 * This maps the failure to an i18n key instead. It branches on the machine-
 * readable `code` the backend now sends (`AppError`'s third argument), with the
 * HTTP status as the fallback for a response that predates a code — an
 * instance can be older than its client, and a status is the one thing every
 * version agrees on.
 *
 * Deliberately a pure function over the error shape, not a hook: the whole
 * point is that the mapping is testable without rendering a form, and the same
 * decision cannot drift between the two places a login can fail.
 */

export interface LoginFailure {
  /** Key inside the `auth` namespace, e.g. `login.errors.invalidCredentials`. */
  key: string;
  /**
   * Whole minutes to wait, rounded up, when the server said how long. Fed to
   * the rate-limited copy as a count so the plural form is the reader's.
   */
  retryAfterMinutes?: number;
}

interface ErrorBody {
  code?: unknown;
  retryAfterSeconds?: unknown;
}

interface AxiosLikeError {
  response?: { status?: number; data?: ErrorBody | string };
}

/** The body is a string for any handler that answered with bare text. */
function bodyOf(err: AxiosLikeError): ErrorBody {
  const data = err.response?.data;
  return typeof data === "object" && data !== null ? data : {};
}

function minutesFrom(seconds: unknown): number | undefined {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.max(1, Math.ceil(seconds / 60));
}

export function loginFailure(err: unknown): LoginFailure {
  const typed = (err ?? {}) as AxiosLikeError;

  // No response at all — the request never reached an instance. Distinct from
  // every server answer below, and the only case where the network is at fault.
  if (!typed.response) return { key: "login.serverUnreachable" };

  const status = typed.response.status;
  const body = bodyOf(typed);
  const code = typeof body.code === "string" ? body.code : undefined;

  if (code === "DB_UNAVAILABLE" || status === 503) return { key: "login.dbUnavailable" };

  if (code === "RATE_LIMITED" || status === 429) {
    const retryAfterMinutes = minutesFrom(body.retryAfterSeconds);
    // Two keys, not one with an optional count: a plural-only key looked up
    // WITHOUT `count` resolves to nothing and react-i18next renders the key
    // itself. The wait is only ever quoted when the server said it.
    return retryAfterMinutes === undefined
      ? { key: "login.errors.rateLimited" }
      : { key: "login.errors.rateLimitedMinutes", retryAfterMinutes };
  }

  if (code === "ACCOUNT_DEACTIVATED") return { key: "login.errors.accountDeactivated" };
  if (code === "INVALID_CREDENTIALS") return { key: "login.errors.invalidCredentials" };

  // Status fallbacks, for an instance that has not yet learned the codes. A
  // 403 from THIS route means one thing only — the account is switched off; it
  // is the deactivation check, not an authorisation rule.
  if (status === 403) return { key: "login.errors.accountDeactivated" };
  if (status === 401) return { key: "login.errors.invalidCredentials" };
  if (status === 400) return { key: "login.errors.missingFields" };

  return { key: "login.failed" };
}
