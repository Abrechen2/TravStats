import { AppError } from "./errorHandler";

type OriginCallback = (err: Error | null, allow?: boolean) => void;

/**
 * The `origin` check for the `cors` middleware, built from `CORS_ORIGIN`
 * ("*", or a comma-separated list).
 *
 * A refused origin is a 403, not a 500. Until 2026-10-04 the check passed a
 * bare `Error`, which carries no status, so the error handler answered every
 * refused cross-origin request with "500 Not allowed by CORS" — an expected
 * refusal reported as a server failure, in the response and in the error log
 * alike (forgejo#183, measured on 2.7.0-rc.4). Nothing was written either
 * way; only the classification was wrong.
 *
 * A request with no `Origin` header (the Companion app, server-to-server,
 * curl) is not a cross-origin request and passes.
 */
export function corsOriginCheck(
  corsOrigin: string
): (origin: string | undefined, callback: OriginCallback) => void {
  if (corsOrigin === "*") return (_origin, callback) => callback(null, true);
  const allowed = corsOrigin
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return (origin, callback) => {
    if (!origin || allowed.includes(origin)) return callback(null, true);
    return callback(new AppError("Not allowed by CORS", 403));
  };
}
