import { isIP } from "node:net";

/**
 * The address the calendar subscription link is built on (owner, 2026-10-26:
 * "wenn ein dyn name bekannt ist dann den link damit machen statt IP").
 *
 * A calendar service such as Google Calendar fetches the feed from the
 * internet, so a link on a LAN IP never reaches it, while a dynamic-DNS name
 * often does. Candidates in order: the public URL, the frontend URL, the
 * request's own host. The first one with a DNS name wins; with none, the first
 * there is — as before. Only the calendar link reads this; every other caller
 * of `getPublicBaseUrl` keeps its address.
 */

export interface FeedHostCandidates {
  publicUrl: string | null;
  frontendUrl: string | null;
  /** `protocol://host` of the request, the fallback that always exists. */
  requestUrl: string;
}

export interface FeedBaseUrl {
  baseUrl: string;
  /** False when the host is a private/loopback IP or `localhost`. */
  reachableFromInternet: boolean;
}

/** The host of a URL without brackets, lower-cased; null when it does not parse. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

const isNamed = (host: string | null): boolean => !!host && isIP(host) === 0;

function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a === 0
  );
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower); // unique-local, link-local
}

/** A host a calendar service on the internet cannot fetch from. */
export function isUnreachableHost(rawHost: string): boolean {
  const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const family = isIP(host);
  if (family === 4) return isPrivateIpv4(host);
  if (family === 6) return isPrivateIpv6(host);
  return false;
}

const trimmed = (url: string): string => url.replace(/\/+$/, "");

export function chooseFeedBaseUrl(candidates: FeedHostCandidates): FeedBaseUrl {
  const urls = [candidates.publicUrl, candidates.frontendUrl, candidates.requestUrl]
    .map((u) => u?.trim())
    .filter((u): u is string => !!u)
    .map(trimmed);
  const chosen = urls.find((u) => isNamed(hostOf(u))) ?? urls[0];
  const host = hostOf(chosen);
  return { baseUrl: chosen, reachableFromInternet: host !== null && !isUnreachableHost(host) };
}
