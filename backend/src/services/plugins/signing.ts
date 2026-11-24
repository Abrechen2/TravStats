/**
 * How a plugin request is signed (spec 2026-11-23-plugins-and-calendar.md,
 * "Request"): HMAC-SHA256 with the plugin's secret over
 *
 *     METHOD "\n" path "\n" timestamp "\n" requestId "\n" body
 *
 * — the method, the path (with its query), the Unix time in seconds, the
 * request id and the exact body bytes. Binding all of them (council, 2026-11-23)
 * means a captured request cannot be replayed to another path or as another
 * method, and the plugin's mandatory request-id cache refuses it twice. The
 * header reads `TravStats-Signature: v1=<hex>`.
 */
import crypto from "crypto";

export const SIGNATURE_SCHEME = "v1";
/** The window a plugin accepts a timestamp in, either side of its own clock. */
export const TIMESTAMP_WINDOW_S = 300;

export interface SignedParts {
  method: string;
  path: string;
  timestamp: number;
  requestId: string;
  body: string;
}

export function signingString(p: SignedParts): string {
  return `${p.method.toUpperCase()}\n${p.path}\n${p.timestamp}\n${p.requestId}\n${p.body}`;
}

export function sign(secret: string, p: SignedParts): string {
  const mac = crypto.createHmac("sha256", secret).update(signingString(p), "utf8").digest("hex");
  return `${SIGNATURE_SCHEME}=${mac}`;
}

/** The plugin side's check (used by the template and the tests): constant-time, in the window. */
export function verify(
  secret: string,
  p: SignedParts,
  header: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000)
): boolean {
  if (!header || Math.abs(nowSeconds - p.timestamp) > TIMESTAMP_WINDOW_S) return false;
  const expected = Buffer.from(sign(secret, p));
  const given = Buffer.from(header);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** A new plugin secret: 32 random bytes, base64url. */
export function newSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}
