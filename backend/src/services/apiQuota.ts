/**
 * Per-provider API quota observation cache.
 *
 * Different providers expose quota information very differently:
 *   - AeroDataBox (RapidAPI): standard `x-ratelimit-requests-limit` /
 *     `x-ratelimit-requests-remaining` headers on every response →
 *     `kind: 'observed'` with real numbers
 *   - AirLabs:     no rate-limit headers; their JSON envelope only
 *                  reports per-call success → `kind: 'not_reported'`
 *   - Aviationstack: same — pagination metadata but no monthly counter
 *                  → `kind: 'not_reported'`
 *   - OpenSky:     IP-based per-second throttling, no monthly quota at
 *                  all → `kind: 'rate_limit_only'`
 *
 * Surfacing them honestly to the UI keeps users from assuming they
 * have headroom they don't (or panicking about a "?" they can't fix).
 *
 * Storage is in-memory and per-userId. Quota is technically per-key on
 * the provider side; when a shared admin key is in use, multiple users
 * see the same numbers under different buckets, which is fine for an
 * indicator.
 */

export type ApiProvider = 'aerodatabox' | 'airlabs' | 'aviationstack' | 'opensky';

export interface ObservedQuota {
  kind: 'observed';
  limit: number | null;
  remaining: number | null;
  observedAt: string;
}

export interface NotReportedQuota {
  kind: 'not_reported';
  /** Static known cap from provider docs, if any. Used as a hint only. */
  knownLimitHint?: number;
}

export interface RateLimitOnlyQuota {
  kind: 'rate_limit_only';
}

export type ProviderQuota = ObservedQuota | NotReportedQuota | RateLimitOnlyQuota;

const ANON = '__anon__';

/** Map<userId, Map<provider, ObservedQuota>>. Static kinds aren't stored —
 *  they come from `getQuotaShape` because they don't change per-user. */
const observed = new Map<string, Map<ApiProvider, ObservedQuota>>();

/**
 * Static description of how each provider reports quota. The `observed`
 * map only ever contains AeroDataBox today; others fall back to the
 * static shape from this map.
 */
const STATIC_QUOTA_SHAPE: Record<ApiProvider, ProviderQuota> = {
  aerodatabox: { kind: 'observed', limit: null, remaining: null, observedAt: '' },
  airlabs: { kind: 'not_reported', knownLimitHint: 1000 },
  aviationstack: { kind: 'not_reported', knownLimitHint: 100 },
  opensky: { kind: 'rate_limit_only' },
};

/**
 * Capture rate-limit info from a provider response. Currently only
 * AeroDataBox sends usable headers; the function is generic so future
 * providers (e.g. Aviationstack pro tier) can plug in.
 */
export function recordObservedQuota(
  provider: ApiProvider,
  userId: string | undefined,
  headers: Record<string, unknown>,
): void {
  // Header keys arrive lowercased from axios.
  const limitRaw = headers['x-ratelimit-requests-limit'];
  const remainingRaw = headers['x-ratelimit-requests-remaining'];
  const limit = typeof limitRaw === 'string' ? parseInt(limitRaw, 10) : NaN;
  const remaining = typeof remainingRaw === 'string' ? parseInt(remainingRaw, 10) : NaN;
  if (!Number.isFinite(limit) && !Number.isFinite(remaining)) return;

  const key = userId ?? ANON;
  let inner = observed.get(key);
  if (!inner) {
    inner = new Map();
    observed.set(key, inner);
  }
  inner.set(provider, {
    kind: 'observed',
    limit: Number.isFinite(limit) ? limit : null,
    remaining: Number.isFinite(remaining) ? remaining : null,
    observedAt: new Date().toISOString(),
  });
}

/**
 * Read the per-user observation for a provider, falling back to the
 * static shape if the provider doesn't expose live numbers OR no call
 * has been made yet this server lifetime.
 */
export function getProviderQuota(provider: ApiProvider, userId?: string): ProviderQuota {
  const inner = observed.get(userId ?? ANON);
  const live = inner?.get(provider);
  if (live) return live;
  return STATIC_QUOTA_SHAPE[provider];
}

/** Returns the shape of every provider's quota for the user — single
 *  fetch from the API-keys page. */
export function getAllProviderQuotas(userId?: string): Record<ApiProvider, ProviderQuota> {
  const providers: ApiProvider[] = ['aerodatabox', 'airlabs', 'aviationstack', 'opensky'];
  const out = {} as Record<ApiProvider, ProviderQuota>;
  for (const p of providers) {
    out[p] = getProviderQuota(p, userId);
  }
  return out;
}

/** Test helper. */
export function __resetApiQuotaForTests(): void {
  observed.clear();
}
