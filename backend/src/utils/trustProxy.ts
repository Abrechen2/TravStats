import net from "net";

/**
 * Which proxies may tell the app who the client is — the `trust proxy` value.
 *
 * `req.ip` keys every address-based rate limit (login, password reset,
 * pairing claim, airport search) and the security logs. Express reads it from
 * `X-Forwarded-For`, trusting only the hops this setting names.
 *
 * It was hard-coded to `1`: trust the nginx inside the container and nothing
 * else. Behind any further reverse proxy that makes `req.ip` the address of
 * THAT proxy for every visitor. Measured on prod 2026-09-16: of 5000 requests
 * reaching the container's nginx, none came from a public address — every
 * external user arrived as the Nginx Proxy Manager, so ten wrong passwords
 * from anyone locked everyone out of logging in for 15 minutes.
 *
 * The fix is to NAME the extra proxy, not to trust more hops blindly. A hop
 * count or `true` believes whatever the client wrote into the header as soon
 * as someone reaches the app past the proxy, and then the key is forgeable.
 * So this accepts only what cannot be tricked that way — the named ranges
 * Express knows, and explicit addresses or CIDRs — plus a hop count for the
 * setups that genuinely need one, and refuses `true`, `false` and 0.
 *
 * Default `loopback`: the container's own nginx, as before, but without also
 * trusting a header a client sends straight to the backend port.
 */

export const DEFAULT_TRUST_PROXY = "loopback";

const NAMED_RANGES = new Set(["loopback", "linklocal", "uniquelocal"]);

function isAddressOrCidr(token: string): boolean {
  const [address, prefix, extra] = token.split("/");
  if (extra !== undefined) return false;
  const family = net.isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * The value for `app.set("trust proxy", …)`. Throws with a message naming the
 * variable on anything it does not understand: a typo here must stop the
 * boot, not silently fall back to trusting the wrong thing.
 */
export function resolveTrustProxy(raw: string | undefined): number | string {
  const value = (raw ?? "").trim();
  if (value === "") return DEFAULT_TRUST_PROXY;

  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops < 1) {
      throw new Error(
        "TRUST_PROXY=0 would ignore the container's own nginx and give every visitor the same address. Use 'loopback' or a hop count of 1 or more.",
      );
    }
    return hops;
  }

  if (/^(true|false)$/i.test(value)) {
    throw new Error(
      `TRUST_PROXY=${value} is not accepted: 'true' believes any X-Forwarded-For a client sends, 'false' ignores the container's nginx. Name your proxy instead, e.g. "loopback, 192.168.1.10".`,
    );
  }

  const tokens = value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const invalid = tokens.filter((t) => !NAMED_RANGES.has(t) && !isAddressOrCidr(t));
  if (tokens.length === 0 || invalid.length > 0) {
    throw new Error(
      `TRUST_PROXY contains ${invalid.length > 0 ? `unrecognised entries (${invalid.join(", ")})` : "no entries"}. Allowed: loopback, linklocal, uniquelocal, IP addresses, CIDR ranges, or a hop count.`,
    );
  }
  return tokens.join(", ");
}
