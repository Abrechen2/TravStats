/**
 * `getCookieSecure` — the one rule for the `Secure` flag on every session cookie.
 *
 * The defect this pins (2.6.2): `docker-compose.prod.yml` passes
 * `COOKIE_SECURE: ${COOKIE_SECURE:-}`, so a user who sets nothing hands the
 * container an EMPTY string — set, not undefined. The old check was
 * `!== undefined` then `!== "false"`, so "" meant Secure, and a fresh install
 * reached over plain http on a LAN address got a cookie the browser refuses to
 * store. Login answered 200 and the very next request said "No token provided".
 */
import type { Request } from "express";

import { getCookieSecure } from "../utils/session";

type Transport = "http" | "https" | "http + X-Forwarded-Proto: https";

function fakeRequest(transport: Transport): Request {
  const headers: Record<string, string> =
    transport === "http + X-Forwarded-Proto: https" ? { "x-forwarded-proto": "https" } : {};
  return {
    protocol: transport === "https" ? "https" : "http",
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

const TRANSPORTS: Transport[] = ["http", "https", "http + X-Forwarded-Proto: https"];

const ORIGINAL_COOKIE_SECURE = process.env.COOKIE_SECURE;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function setCookieSecure(value: string | undefined): void {
  if (value === undefined) delete process.env.COOKIE_SECURE;
  else process.env.COOKIE_SECURE = value;
}

afterEach(() => {
  setCookieSecure(ORIGINAL_COOKIE_SECURE);
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("getCookieSecure — production", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });

  // Unset, empty and whitespace are the same thing: nobody chose a value, so
  // the transport decides. That is what the compose file's "leave it empty"
  // promised and what 2.6.2 broke.
  const AUTO_DETECT = { http: false, https: true, "http + X-Forwarded-Proto: https": true };
  const cases: Array<[string, string | undefined, Record<Transport, boolean>]> = [
    ["unset", undefined, AUTO_DETECT],
    ['""', "", AUTO_DETECT],
    ['"  " (whitespace)', "  ", AUTO_DETECT],
    ['"false"', "false", { http: false, https: false, "http + X-Forwarded-Proto: https": false }],
    [
      '" false " (padded)',
      " false ",
      { http: false, https: false, "http + X-Forwarded-Proto: https": false },
    ],
    ['"true"', "true", { http: true, https: true, "http + X-Forwarded-Proto: https": true }],
    // The polarity note: any real value other than "false" is secure, so
    // COOKIE_SECURE=1 must never quietly become an insecure cookie.
    ['"1"', "1", { http: true, https: true, "http + X-Forwarded-Proto: https": true }],
  ];

  for (const [label, value, expected] of cases) {
    for (const transport of TRANSPORTS) {
      it(`COOKIE_SECURE=${label} over ${transport} → secure=${expected[transport]}`, () => {
        setCookieSecure(value);
        expect(getCookieSecure(fakeRequest(transport))).toBe(expected[transport]);
      });
    }
  }
});

describe("getCookieSecure — outside production", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "development";
  });

  it.each([undefined, "", "  "])("COOKIE_SECURE=%p never marks a dev cookie Secure", (value) => {
    setCookieSecure(value);
    for (const transport of TRANSPORTS) {
      expect(getCookieSecure(fakeRequest(transport))).toBe(false);
    }
  });

  it('an explicit "true" still wins in development', () => {
    setCookieSecure("true");
    expect(getCookieSecure(fakeRequest("http"))).toBe(true);
  });
});
