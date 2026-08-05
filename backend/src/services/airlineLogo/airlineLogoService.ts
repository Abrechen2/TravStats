import crypto from "crypto";
import logger from "../../utils/logger";
import { getApiKey } from "../apiKeyResolver";
import {
  getCachedLogoEntry,
  putCachedLogo,
  touchFailedRefresh,
  isStale,
  type CachedLogo,
  type CachedLogoEntry,
  type LogoSource,
} from "./logoCache";
import { getVendoredLogo } from "./vendoredLogos";

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

const KIWI_BASE = "https://images.kiwi.com/airlines";
// kiwi offers 32/64/128 only (256+ is a 404). 128 is the largest, and the
// flights-table tile renders at 44–56 px, so 128 also covers a 2× display.
const KIWI_SIZE = 128;

// kiwi answers HTTP 200 with a generic grey-aeroplane glyph for codes it does
// not know. Unlike Daisycon's, this placeholder IS byte-stable: every unknown
// code returns the identical image (verified 2026-07-14 across ZZ/XX/99).
export const KIWI_PLACEHOLDER_MD5S = new Set(["946bca53c7e1c56d66a7f13e69520aee"]);

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

/**
 * The keyless default. kiwi returns a finished square brand tile that already
 * carries the airline's own background — Lufthansa white, Delta navy — so
 * nothing downstream needs a brand colour, a manifest or a contrast heuristic.
 *
 * IATA only: the endpoint takes a 2-letter code. A 3-letter ICAO is a miss here
 * and falls through, which is correct — Daisycon accepts ICAO.
 */
async function fromKiwi(code: string): Promise<CachedLogo | null> {
  if (code.length !== 2) return null;
  const logo = await fetchImage(`${KIWI_BASE}/${KIWI_SIZE}/${code}.png`);
  if (!logo) return null;
  if (KIWI_PLACEHOLDER_MD5S.has(md5(logo.body))) return null;
  return logo;
}

async function fromDaisycon(code: string): Promise<CachedLogo | null> {
  // Daisycon only has the full wordmark logo; every variant maps onto it.
  const param = code.length === 3 ? "icao" : "iata";
  const logo = await fetchImage(`${DAISYCON_BASE}?${param}=${code}&width=300&height=150`);
  if (logo && DAISYCON_PLACEHOLDER_MD5S.has(md5(logo.body))) return null;
  return logo;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOGO_MAX_AGE_DAYS = 30;
// A typo'd LOGO_MAX_AGE_DAYS (e.g. "30d") would make Number() return NaN, and
// `now - fetchedAt > NaN` is always false — so NOTHING would ever look stale,
// the nightly sweep would become a silent no-op, and logos would freeze forever.
// Fall back to the default on any non-finite / non-positive value.
const parsedMaxAgeDays = Number(process.env.LOGO_MAX_AGE_DAYS);
const LOGO_MAX_AGE_DAYS =
  Number.isFinite(parsedMaxAgeDays) && parsedMaxAgeDays > 0
    ? parsedMaxAgeDays
    : DEFAULT_LOGO_MAX_AGE_DAYS;
export const LOGO_MAX_AGE_MS = LOGO_MAX_AGE_DAYS * DAY_MS;
export const RETRY_BACKOFF_MS = 6 * 60 * 60 * 1000;

// One in-flight refresh per key. A flights table renders hundreds of rows at
// once; without this, a single stale logo would fan out into hundreds of
// identical upstream requests.
const inFlight = new Map<string, Promise<boolean>>();

/** Test seam: await every refresh currently in flight. */
export async function __flushRefreshesForTests(): Promise<void> {
  await Promise.allSettled([...inFlight.values()]);
}

/**
 * Test seam: forget any in-flight refreshes without waiting for them.
 *
 * A mocked upstream that never resolves (proving "the caller does not block")
 * otherwise leaks a permanently-pending entry into this module-level map for
 * the rest of the test run — every later `__flushRefreshesForTests()` in the
 * same file would then hang forever on that one dangling promise.
 */
export function __resetInFlightForTests(): void {
  inFlight.clear();
}

// Tiers, in order of what they cost the instance. A miss in one tier must
// fall through, never be papered over: that is why each returns null rather
// than a placeholder.
//
//   logostream — best quality, burns an admin's key budget, so it only runs
//                where a key is configured. NOT complete (British Airways is
//                missing), which is why the keyless tier below is not merely
//                a fallback.
//   vendored   — the ICON tier. Square marks for compact surfaces. It no
//                longer serves wordmarks: its `logo.svg` was missing for 10
//                of 93 airlines and its marks need a plate we no longer draw.
//   kiwi       — the KEYLESS DEFAULT for wordmark-shaped variants. A finished
//                brand tile with its own background; 133/133 measured.
//   Daisycon   — the tail net for whatever even kiwi does not know.
async function fetchFromChain(
  code: string,
  variant: LogoVariant
): Promise<{ logo: CachedLogo; source: LogoSource } | null> {
  const premium = await fromLogostream(code, variant);
  if (premium) return { logo: premium, source: "logostream" };
  const vendored = getVendoredLogo(code, variant);
  if (vendored) return { logo: vendored, source: "vendored" };
  const kiwi = await fromKiwi(code);
  if (kiwi) return { logo: kiwi, source: "kiwi" };
  const daisycon = await fromDaisycon(code);
  if (daisycon) return { logo: daisycon, source: "daisycon" };
  return null;
}

/**
 * Re-fetch one cache key through the chain. Returns true when the bytes changed.
 *
 * A failure leaves the cached bytes AND their fetchedAt untouched: a stale logo
 * beats no logo, and the entry must stay visibly stale so the next sweep retries
 * it.
 */
export async function refreshLogo(key: string): Promise<boolean> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = (async (): Promise<boolean> => {
    // The FIRST hyphen always separates code from variant: airline codes are
    // route-validated `[A-Za-z0-9]{2,3}` and never contain a hyphen, but the
    // "logo-white" variant does — lastIndexOf would mis-parse "XX-logo-white"
    // into code "XX-logo", variant "white".
    const sep = key.indexOf("-");
    const code = key.slice(0, sep);
    const variant = key.slice(sep + 1) as LogoVariant;
    try {
      const found = await fetchFromChain(code, variant);
      if (!found) {
        await touchFailedRefresh(key);
        return false;
      }
      await putCachedLogo(key, found.logo, found.source);
      return true;
    } catch (error) {
      logger.warn(
        { operation: "logo_refresh_failed", key, message: (error as Error).message },
        "airline logo refresh failed"
      );
      await touchFailedRefresh(key);
      return false;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, task);
  return task;
}

function dueForRetry(entry: CachedLogoEntry): boolean {
  if (entry.lastAttemptAt === null) return true;
  return Date.now() - entry.lastAttemptAt > RETRY_BACKOFF_MS;
}

export async function resolveAirlineLogo(
  code: string,
  variant: LogoVariant
): Promise<CachedLogo | null> {
  const cacheKey = `${code}-${variant}`;

  const cached = await getCachedLogoEntry(cacheKey);
  if (cached) {
    // Stale-while-revalidate: the caller ALWAYS gets bytes now. A stale entry
    // refreshes behind the response, so no user ever waits on an upstream and a
    // dead upstream never blocks a page.
    if (isStale(cached, LOGO_MAX_AGE_MS) && dueForRetry(cached)) {
      void refreshLogo(cacheKey);
    }
    return { body: cached.body, contentType: cached.contentType };
  }

  const negativeUntil = negativeCache.get(cacheKey);
  if (negativeUntil !== undefined && negativeUntil > Date.now()) return null;
  negativeCache.delete(cacheKey);

  const found = await fetchFromChain(code, variant);
  if (!found) {
    negativeCache.set(cacheKey, Date.now() + NEGATIVE_TTL_MS);
    return null;
  }

  await putCachedLogo(cacheKey, found.logo, found.source);
  return found.logo;
}
