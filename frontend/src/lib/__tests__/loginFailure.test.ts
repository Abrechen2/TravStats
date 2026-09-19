import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loginFailure } from "../loginFailure";

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

    for (const locale of ["de", "en"]) {
      const tree = load(locale);
      for (const err of cases) {
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
