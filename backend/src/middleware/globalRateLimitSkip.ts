/**
 * Loopback, the Docker bridge and the RFC 1918 private ranges.
 *
 * Lives in its own module, not in `index.ts` beside the global limiter, because
 * it is the one part of that limiter worth testing on its own, and `index.ts`
 * sits on its frozen size ceiling. `rateLimit.ts` re-exports it, so callers keep
 * one import — it moved out when that file reached the 800-line ceiling.
 */
const LAN_IP_RE = /^(?:::1|::ffff:)?(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

/**
 * Whether the global `/api` limiter lets a request through uncounted.
 *
 * Self-hosted LAN deployments — Unraid, a home-lab compose stack — behave the
 * same as dev and are not throttled. **Outside development the skip is off
 * entirely**, and that is the correction: a production instance behind a
 * reverse proxy that is not named in `TRUST_PROXY` sees the PROXY's address in
 * `req.ip`, which is private, so every visitor on Earth presented as LAN and
 * the cap was lifted for all of them at once — a limiter silently absent
 * exactly where it is the only thing standing in front of the login route
 * (security audit of 2026-09-19, finding 5). It was measured NOT to be
 * happening on the public preview, which sets `TRUST_PROXY` and logs the real
 * client address; it is every instance that forgets to that this protects.
 *
 * `NODE_ENV` is read per request, not captured at build time, so a test can
 * ask both questions of the same limiter.
 */
export function skipGlobalRateLimit(ip: string | undefined): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return LAN_IP_RE.test(ip ?? "");
}
