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

/**
 * RapidAPI / AeroDataBox return TWO independent counters:
 *
 *   - **units** — `x-ratelimit-api-units-*`. The actual tier quota
 *     (e.g. BASIC = 600/month). Some endpoints cost more than one unit
 *     per HTTP request (e.g. enabling `withAircraftImage=true` adds a
 *     unit). This is the limit users care about and the one that maps
 *     to "AeroDataBox Free-Tier 600/Monat" on the pricing page.
 *
 *   - **requests** — `x-ratelimit-requests-*`. A separate per-period
 *     HTTP-request counter (RapidAPI BASIC default 2400). Always >=
 *     units count; runs out later. Useful as a secondary indicator
 *     but NOT the user's plan quota.
 *
 * We surface `units` as the primary "remaining/limit" pair and keep
 * `requests` as a secondary detail so the bulk-refresh card and confirm
 * modal don't inflate the budget the user actually has.
 */
export interface ObservedQuota {
  kind: 'observed';
  /** Primary tier quota (e.g. 600/month for AeroDataBox BASIC). */
  limit: number | null;
  remaining: number | null;
  /** Secondary HTTP-request counter — always >= units, may not exist
   *  on every provider. UI uses it as a tie-breaker / extra info. */
  requestsLimit?: number | null;
  requestsRemaining?: number | null;
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
  const parseHeader = (name: string): number => {
    const raw = headers[name];
    return typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  };

  // Header keys arrive lowercased from axios. Prefer the API-units pair
  // (the actual tier quota) over the bare "requests" pair (HTTP-call
  // counter, generally 4× larger and irrelevant for plan budgeting).
  const unitsLimit = parseHeader('x-ratelimit-api-units-limit');
  const unitsRemaining = parseHeader('x-ratelimit-api-units-remaining');
  const requestsLimit = parseHeader('x-ratelimit-requests-limit');
  const requestsRemaining = parseHeader('x-ratelimit-requests-remaining');

  // Fall back to the requests counter only when units headers are
  // absent — that way providers that don't have the units split still
  // produce a useful number.
  const haveUnits = Number.isFinite(unitsLimit) || Number.isFinite(unitsRemaining);
  const haveRequests = Number.isFinite(requestsLimit) || Number.isFinite(requestsRemaining);
  if (!haveUnits && !haveRequests) return;

  const primaryLimit = haveUnits ? unitsLimit : requestsLimit;
  const primaryRemaining = haveUnits ? unitsRemaining : requestsRemaining;

  const key = userId ?? ANON;
  let inner = observed.get(key);
  if (!inner) {
    inner = new Map();
    observed.set(key, inner);
  }
  inner.set(provider, {
    kind: 'observed',
    limit: Number.isFinite(primaryLimit) ? primaryLimit : null,
    remaining: Number.isFinite(primaryRemaining) ? primaryRemaining : null,
    requestsLimit: Number.isFinite(requestsLimit) ? requestsLimit : null,
    requestsRemaining: Number.isFinite(requestsRemaining) ? requestsRemaining : null,
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
