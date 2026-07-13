import crypto from "crypto";
import logger from "../../utils/logger";
import { getApiKey } from "../apiKeyResolver";
import { getCachedLogo, putCachedLogo, type CachedLogo } from "./logoCache";

export type LogoVariant = "icon" | "logo" | "logo-white" | "tail";

// Daisycon serves a generic placeholder with HTTP 200 for unknown airlines.
// The placeholder is NOT byte-stable (multiple render generations exist),
// so this hash set is BEST-EFFORT: it filters the generations we have
// observed; an unrecognised generation slips through and is served/cached
// like a real logo. That is cosmetic-only (the same image users saw before
// this proxy existed) and only reachable for airlines logostream does not
// know. Add newly observed hashes here.
const DAISYCON_PLACEHOLDER_MD5S = new Set([
  "e868e45186e3f2e758f42dcd1029da2d",
  "fdbd908af301103989b2373c18c170a5",
  "9722f0e8186537a02ca39846f7b4cf7b",
]);

// Confirmed empirically 2026-07-12 — see
// docs/superpowers/plans/2026-07-12-airline-logo-api-fixtures.md. Neither
// candidate host from the original task brief served real logos; this is the
// third, real image host discovered via the metadata API's `logo` field.
const LOGOSTREAM_BASE = "https://airlines-api.logostream.dev";
const DAISYCON_BASE = "https://images.daisycon.io/airline";
const FETCH_TIMEOUT_MS = 5_000;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;

// In-memory negative cache: a miss today may resolve after logostream adds
// the airline, so it expires — unlike positive entries, which are immutable.
const negativeCache = new Map<string, number>();
export function __resetNegativeCacheForTests(): void {
  negativeCache.clear();
}

function md5(buf: Buffer): string {
  return crypto.createHash("md5").update(buf).digest("hex");
}

// The logostream key travels as a `key=` query param (not a header) — mask it
// before any URL ever reaches the logs, since Pino's key-based redaction
// paths ('apiKey', 'api_key', ...) don't cover a key embedded inside a URL
// string.
function maskKey(url: string): string {
  return url.replace(/key=[^&]+/, "key=***");
}

async function fetchImage(url: string): Promise<CachedLogo | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length === 0) return null;
    return { body, contentType };
  } catch (error) {
    // Scrub any embedded API keys from the error message before logging.
    const message = error instanceof Error
      ? error.message.replace(/key=[^&\s]+/g, "key=***")
      : "unknown error";
    logger.warn(
      { operation: "logo_fetch_failed", url: maskKey(url), message },
      "airline logo fetch failed"
    );
    return null;
  }
}

function buildLogostreamUrl(code: string, variant: LogoVariant, key: string): string {
  const kind = code.length === 3 ? "icao" : "iata";
  return `${LOGOSTREAM_BASE}/airlines/${kind}/${code}?variant=${variant}&key=${encodeURIComponent(key)}`;
}

async function fromLogostream(code: string, variant: LogoVariant): Promise<CachedLogo | null> {
  // Admin-global key (encrypted in admin_settings, set via the admin UI)
  // wins over the LOGOSTREAM_API_KEY env fallback — standard provider pattern.
  const key = await getApiKey("logostream");
  if (!key) return null;

  const logo = await fetchImage(buildLogostreamUrl(code, variant, key));
  // logostream never 404s for an unknown airline — it always answers 200
  // with a dynamically generated image/svg+xml placeholder instead. Real
  // logos are always image/png, so anything else is treated as a miss.
  if (!logo || logo.contentType !== "image/png") return null;
  return logo;
}

async function fromDaisycon(code: string): Promise<CachedLogo | null> {
  // Daisycon only has the full wordmark logo; every variant maps onto it.
  const param = code.length === 3 ? "icao" : "iata";
  const logo = await fetchImage(`${DAISYCON_BASE}?${param}=${code}&width=300&height=150`);
  if (logo && DAISYCON_PLACEHOLDER_MD5S.has(md5(logo.body))) return null;
  return logo;
}

export async function resolveAirlineLogo(
  code: string,
  variant: LogoVariant
): Promise<CachedLogo | null> {
  const cacheKey = `${code}-${variant}`;

  const cached = await getCachedLogo(cacheKey);
  if (cached) return cached;

  const negativeUntil = negativeCache.get(cacheKey);
  if (negativeUntil !== undefined && negativeUntil > Date.now()) return null;
  negativeCache.delete(cacheKey);

  const logo = (await fromLogostream(code, variant)) ?? (await fromDaisycon(code));
  if (!logo) {
    negativeCache.set(cacheKey, Date.now() + NEGATIVE_TTL_MS);
    return null;
  }

  await putCachedLogo(cacheKey, logo);
  return logo;
}
