import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loginFailure, PASSWORD_LOGIN_COPY, type LoginFailureCopy } from "../loginFailure";

/**
 * forgejo#88, findings 3 and 4.
 *
 * The audit signed in with a wrong password on a German page and was answered
 * "Invalid credentials" — the backend's own log prose, printed verbatim. Then
 * it met the auth limiter and was answered with the raw English 429 line, with
 * no wait and no next step.
 *
 * The regression these tests pin is not "an error is shown" — one always was.
 * It is that the SERVER'S WORDS never reach the reader: every branch resolves
 * to a key this repository owns in both locales.
 */

const axiosLike = (status: number, data: unknown): unknown => ({ response: { status, data } });

describe("loginFailure — the login form speaks the reader's language", () => {
  it("answers a wrong password with its own key, not the server's English prose", () => {
    // Exactly what the live backend sends (measured 2026-09-19):
    // POST /auth/login → 401 {"error":"Invalid credentials"}
    const failure = loginFailure(
      axiosLike(401, { error: "Invalid credentials", code: "INVALID_CREDENTIALS" })
    );
    expect(failure.key).toBe("login.errors.invalidCredentials");
    expect(JSON.stringify(failure)).not.toContain("Invalid credentials");
  });

  it("maps a 401 even from an instance older than this client, which sends no code", () => {
    expect(loginFailure(axiosLike(401, { error: "Invalid credentials" })).key).toBe(
      "login.errors.invalidCredentials"
    );
  });

  it("tells a deactivated account apart from a wrong password", () => {
    expect(
      loginFailure(
        axiosLike(403, { error: "This account has been deactivated", code: "ACCOUNT_DEACTIVATED" })
      ).key
    ).toBe("login.errors.accountDeactivated");
    // A 403 from this route can only be the deactivation check.
    expect(loginFailure(axiosLike(403, { error: "This account has been deactivated" })).key).toBe(
      "login.errors.accountDeactivated"
    );
  });

  it("names the rate limit as the cause, and quotes the wait the server sent", () => {
    const failure = loginFailure(
      axiosLike(429, {
        error: "Too many authentication attempts, please try again later",
        code: "RATE_LIMITED",
        retryAfterSeconds: 540,
      })
    );
    expect(failure.key).toBe("login.errors.rateLimitedMinutes");
    // 540 s rounds UP to 9 whole minutes — never down, or the reader retries early.
    expect(failure.retryAfterMinutes).toBe(9);
  });

  it("rounds a sub-minute wait up to one rather than saying zero minutes", () => {
    expect(
      loginFailure(axiosLike(429, { code: "RATE_LIMITED", retryAfterSeconds: 4 })).retryAfterMinutes
    ).toBe(1);
  });

  it("falls back to the wait-less key when the body carries no seconds", () => {
    // express-rate-limit's `message` option answers with a bare STRING body,
    // so `data.code` cannot exist — this is the shape an older instance sends.
    const failure = loginFailure(
      axiosLike(429, "Too many authentication attempts, please try again later")
    );
    expect(failure.key).toBe("login.errors.rateLimited");
    expect(failure.retryAfterMinutes).toBeUndefined();
  });

  it("keeps the network, database and unknown cases apart", () => {
    expect(loginFailure({}).key).toBe("login.serverUnreachable");
    expect(loginFailure(axiosLike(503, { code: "DB_UNAVAILABLE" })).key).toBe(
      "login.dbUnavailable"
    );
    expect(loginFailure(axiosLike(400, { error: "Validation failed" })).key).toBe(
      "login.errors.missingFields"
    );
    expect(loginFailure(axiosLike(500, { error: "Internal server error" })).key).toBe(
      "login.failed"
    );
  });

  /**
   * The same three answers on every sign-in surface, and nothing else shared.
   *
   * `authLimiter` sits on `/auth/login`, `/auth/2fa/verify` and
   * `/auth/passkeys/login/*` in ONE address-keyed bucket, so all three screens
   * can meet the 429 — that is what has to travel. What must NOT travel is a
   * status the surface cannot read: `/passkeys/login/verify` answers 403 for a
   * deactivated account AND for "set a new password first", so a shared
   * 403 rule would be wrong half the time there.
   */
  describe("per-surface copy", () => {
    const TWO_FACTOR: LoginFailureCopy = { refused: "twoFactor.rejected" };
    const PASSKEY: LoginFailureCopy = { refused: "login.passkeyFailed" };

    it("carries the rate limit and the database to every surface", () => {
      for (const copy of [TWO_FACTOR, PASSKEY]) {
        expect(
          loginFailure(axiosLike(429, { code: "RATE_LIMITED", retryAfterSeconds: 120 }), copy)
        ).toEqual({ key: "login.errors.rateLimitedMinutes", retryAfterMinutes: 2 });
        expect(loginFailure(axiosLike(503, { code: "DB_UNAVAILABLE" }), copy).key).toBe(
          "login.dbUnavailable"
        );
      }
    });

    it("refuses to read a 403 on a surface that cannot tell what it means", () => {
      // The passkey screen: never "your account is switched off".
      expect(loginFailure(axiosLike(403, { error: "Account is deactivated" }), PASSKEY).key).toBe(
        "login.passkeyFailed"
      );
      // The password form: 403 can only be the deactivation check there.
      expect(loginFailure(axiosLike(403, {}), PASSWORD_LOGIN_COPY).key).toBe(
        "login.errors.accountDeactivated"
      );
    });

    it("does not call a browser-side ceremony failure a server outage", () => {
      // `startAuthentication` throws in the BROWSER for a timeout, an
      // unsupported authenticator or a mismatched rpId. None of those reached
      // the server, so the passkey copy leaves `unreachable` unset.
      expect(loginFailure(new Error("boom"), PASSKEY).key).toBe("login.passkeyFailed");
      // The password form only ever fails through axios, so it keeps the answer.
      expect(loginFailure(new Error("boom"), PASSWORD_LOGIN_COPY).key).toBe(
        "login.serverUnreachable"
      );
    });

    it("keeps a server error apart from a wrong password on the form that can tell", () => {
      expect(loginFailure(axiosLike(500, {}), PASSWORD_LOGIN_COPY).key).toBe("login.failed");
      // A surface with one message for everything says that one message.
      expect(loginFailure(axiosLike(500, {}), TWO_FACTOR).key).toBe("twoFactor.rejected");
    });
  });

  /**
   * The whole mapping is worthless if a key is missing: react-i18next renders
   * the key itself, so the reader would see `login.errors.invalidCredentials`
   * where the English prose used to be — a worse answer than the bug.
   */
  it("names only keys that exist in both locales", () => {
    const load = (locale: string): Record<string, unknown> =>
      JSON.parse(
        fs.readFileSync(
          path.resolve(__dirname, "..", "..", "i18n", "resources", locale, "auth.json"),
          "utf-8"
        )
      ) as Record<string, unknown>;

    const at = (tree: Record<string, unknown>, dotted: string): unknown =>
      dotted.split(".").reduce<unknown>((node, part) => {
        if (typeof node !== "object" || node === null) return undefined;
        return (node as Record<string, unknown>)[part];
      }, tree);

    const cases: unknown[] = [
      {},
      axiosLike(400, {}),
      axiosLike(401, {}),
      axiosLike(403, {}),
      axiosLike(429, { retryAfterSeconds: 60 }),
      axiosLike(429, {}),
      axiosLike(500, {}),
      axiosLike(503, {}),
    ];

    // Every copy object the app actually passes, not just the default: a key
    // named only by the 2FA or passkey screen is exactly as silent.
    const copies: LoginFailureCopy[] = [
      PASSWORD_LOGIN_COPY,
      { refused: "twoFactor.rejected" },
      { refused: "login.passkeyFailed" },
    ];

    for (const locale of ["de", "en"]) {
      const tree = load(locale);
      for (const err of cases) {
        for (const copy of copies) {
          const { key: k, retryAfterMinutes: m } = loginFailure(err, copy);
          for (const candidate of m === undefined ? [k] : [`${k}_one`, `${k}_other`]) {
            expect(at(tree, candidate), `${locale}: ${candidate}`).toBeTypeOf("string");
          }
        }
        const { key, retryAfterMinutes } = loginFailure(err);
        // A plural key resolves through its `_one` / `_other` variants.
        const candidates = retryAfterMinutes === undefined ? [key] : [`${key}_one`, `${key}_other`];
        for (const candidate of candidates) {
          expect(at(tree, candidate), `${locale}: ${candidate}`).toBeTypeOf("string");
        }
      }
    }
  });
});
