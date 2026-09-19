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
 * decision cannot drift between the places a login can fail.
 *
 * There are THREE such places, not one. `authLimiter` sits on `/auth/login`,
 * on `/auth/2fa/verify` and on `/auth/passkeys/login/*` — one bucket, keyed by
 * address — so a reader who mistypes a TOTP code ten times, or whose password
 * manager retries a passkey, meets the same 429 as at the password field. Both
 * of those screens threw the response away for a fixed line ("Code abgelehnt",
 * "Passkey-Anmeldung fehlgeschlagen"), which names the wrong cause at exactly
 * the moment the reader most needs the right one: the code may have been
 * correct.
 */

/**
 * The copy a particular sign-in surface answers with.
 *
 * Only three failures mean the same thing everywhere — no response at all, the
 * database being down, and the rate limit. Everything else is surface-specific,
 * and this is where that gets said out loud rather than guessed from a status.
 *
 * The guessing matters. `/auth/passkeys/login/verify` answers **403** both for a
 * deactivated account AND for "set a new password before signing in with a
 * passkey" — two different things under one status — so a shared 403 → "your
 * account is switched off" rule would be wrong half the time on that screen.
 * A surface names the distinctions it can actually make, and no others.
 */
export interface LoginFailureCopy {
  /** What a refused attempt reads — a wrong password, a wrong code, a passkey the server would not take. */
  refused: string;
  /**
   * Anything the surface cannot attribute at all — a 500, say. Defaults to
   * `refused`, which is right for the 2FA and passkey screens (both had ONE
   * message for every failure before this) and wrong for the password form: a
   * server error is not a wrong password, and saying so would send the reader
   * to re-type a password that was correct.
   */
  fallback?: string;
  /**
   * What "no response at all" reads — the request never reached an instance.
   *
   * Only for a surface where NOT reaching the server is the only way to fail
   * without an answer. The password form qualifies: every failure there comes
   * out of one axios call. The passkey screen does NOT — `startAuthentication`
   * throws in the BROWSER for a timeout, an unsupported authenticator or a
   * mismatched rpId, and none of those is the server being down. Left unset,
   * an answerless failure falls through to `fallback`/`refused`, which is what
   * both of those screens said before this existed.
   */
  unreachable?: string;
  /** Only for a surface where a 403 can mean nothing but a switched-off account. */
  deactivated?: string;
  /** Only for a surface where a 400 is a field the reader left empty. */
  malformed?: string;
}

/**
 * The password form's own copy, and the default — it is the surface with the
 * most to distinguish, and the one the codes were added for.
 */
export const PASSWORD_LOGIN_COPY: LoginFailureCopy = {
  refused: "login.errors.invalidCredentials",
  fallback: "login.failed",
  unreachable: "login.serverUnreachable",
  deactivated: "login.errors.accountDeactivated",
  malformed: "login.errors.missingFields",
};

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

export function loginFailure(
  err: unknown,
  copy: LoginFailureCopy = PASSWORD_LOGIN_COPY
): LoginFailure {
  const typed = (err ?? {}) as AxiosLikeError;

  // ── The three shared cases. Same meaning on every sign-in surface. ────────

  // No response at all. For the password form that can only be the network;
  // on a surface that can also fail before it ever asks, the caller says so by
  // leaving `unreachable` unset, and this is treated as any other failure.
  if (!typed.response) return { key: copy.unreachable ?? copy.fallback ?? copy.refused };

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

  // ── Surface-specific, and only where the surface said it can tell. ───────

  if (code === "ACCOUNT_DEACTIVATED" && copy.deactivated) return { key: copy.deactivated };
  if (code === "INVALID_CREDENTIALS") return { key: copy.refused };

  // Status fallbacks, for an instance that has not yet learned the codes.
  // Guarded by the copy rather than applied everywhere: a 403 means only "this
  // account is switched off" on the PASSWORD form, and something else as well
  // on the passkey one.
  if (status === 403 && copy.deactivated) return { key: copy.deactivated };
  if (status === 400 && copy.malformed) return { key: copy.malformed };
  if (status === 401) return { key: copy.refused };

  return { key: copy.fallback ?? copy.refused };
}
