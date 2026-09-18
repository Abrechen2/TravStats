import { skipGlobalRateLimit } from "../rateLimit";

/**
 * Finding 5 of the cold security audit of 2026-09-19: the global `/api`
 * limiter skipped any request whose source address was private, and a
 * production instance behind a reverse proxy that is not named in
 * `TRUST_PROXY` sees the PROXY in `req.ip`. Every visitor then presented as
 * LAN and the cap was lifted for all of them at once — the limiter silently
 * absent exactly where it is the only thing in front of the login route.
 *
 * So the skip is a DEVELOPMENT and self-hosted convenience, and outside
 * development there is no skip at all. Measured on the public preview that
 * prompted the audit: `TRUST_PROXY=loopback,uniquelocal` is set there and the
 * log carries the real client address, so that instance was never affected —
 * this guards the instance that forgets.
 */
describe("skipGlobalRateLimit", () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  const privateAddresses = [
    "127.0.0.1",
    "::ffff:127.0.0.1",
    "::ffff:192.168.1.10",
    "10.0.0.7",
    "172.16.0.3",
    "172.31.255.254",
  ];

  it.each(privateAddresses)("skips %s outside production", (ip) => {
    process.env.NODE_ENV = "development";
    expect(skipGlobalRateLimit(ip)).toBe(true);
  });

  it.each(privateAddresses)("counts %s in production", (ip) => {
    process.env.NODE_ENV = "production";
    expect(skipGlobalRateLimit(ip)).toBe(false);
  });

  it("counts a public address either way", () => {
    process.env.NODE_ENV = "development";
    expect(skipGlobalRateLimit("87.138.182.241")).toBe(false);
    process.env.NODE_ENV = "production";
    expect(skipGlobalRateLimit("87.138.182.241")).toBe(false);
  });

  it("counts a bare IPv6 loopback, which the pattern has never matched", () => {
    // Measured, not designed: the optional `::1` prefix in the pattern must
    // still be followed by an IPv4 private prefix, so `::1` on its own falls
    // through. Written down because it looks like an oversight and errs the
    // safe way — an address that is not skipped is an address that is counted.
    process.env.NODE_ENV = "development";
    expect(skipGlobalRateLimit("::1")).toBe(false);
  });

  it("counts a request with no source address at all", () => {
    process.env.NODE_ENV = "development";
    expect(skipGlobalRateLimit(undefined)).toBe(false);
  });

  it("does not mistake 172.15 or 172.32 for the private range", () => {
    // The RFC 1918 block is 172.16–172.31; the two neighbours are public.
    process.env.NODE_ENV = "development";
    expect(skipGlobalRateLimit("172.15.0.1")).toBe(false);
    expect(skipGlobalRateLimit("172.32.0.1")).toBe(false);
  });
});
