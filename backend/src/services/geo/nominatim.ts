import logger from "../../utils/logger";

const BASE_URL = "https://nominatim.openstreetmap.org/search";
// Nominatim's usage policy demands a descriptive UA and at most 1 req/s.
const USER_AGENT = "TravStats/1.0 (self-hosted travel logbook)";
const MIN_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 5000;

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface GeocodeParts {
  address?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface ResolveCoordinatesInput extends GeocodeParts {
  lat?: number | null;
  lon?: number | null;
}

interface NominatimRow {
  lat?: unknown;
  lon?: unknown;
}

// Geocoding results for a given normalized query are stable for the process
// lifetime, so an unbounded cache is safe and small in practice.
const cache = new Map<string, Coordinates | null>();

// Serializes every outbound request onto a single chain so concurrent saves
// cannot burst past Nominatim's 1 req/s limit — the throttle is process-wide,
// not per-call, because `queue` is reassigned to the tail of every request.
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function buildQuery(parts: GeocodeParts): string {
  return [parts.address, parts.city, parts.country]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p)
    .join(", ");
}

async function throttle(): Promise<void> {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

function parseRow(row: NominatimRow): Coordinates | null {
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

async function fetchCoordinates(query: string): Promise<Coordinates | null> {
  const url = `${BASE_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    logger.warn({ query, status: res.status }, "geocoding lookup non-OK");
    return null;
  }
  const rows = (await res.json()) as NominatimRow[];
  if (!Array.isArray(rows) || rows.length === 0) {
    logger.warn({ query }, "geocoding found no results");
    return null;
  }
  const coords = parseRow(rows[0]);
  if (coords === null) {
    logger.warn({ query, row: rows[0] }, "geocoding response had unparseable coordinates");
  }
  return coords;
}

/**
 * Resolve free-text address parts to coordinates via OSM Nominatim.
 * Never throws — every failure path (network error, non-OK, no result,
 * unparseable coordinates) logs a warning and resolves to `null` so a
 * lodging save is never blocked by a flaky or rate-limiting geocoder.
 */
export async function geocodeAddress(parts: GeocodeParts): Promise<Coordinates | null> {
  const query = buildQuery(parts);
  if (!query) return null;

  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  // Chain onto the shared queue so this call's request (and its throttle
  // wait) is serialized after every other in-flight/queued geocode call.
  const task = queue.then(async () => {
    await throttle();
    try {
      const coords = await fetchCoordinates(query);
      // Only cache a definitive answer (found or confirmed-empty/unparseable).
      // A thrown error is transient (network blip, timeout) and must not
      // poison the cache for the process lifetime.
      cache.set(key, coords);
      return coords;
    } catch (error) {
      logger.warn({ error, query }, "geocoding failed");
      return null;
    }
  });
  queue = task.catch(() => undefined);
  return task;
}

/**
 * Route-facing helper: returns `null` to mean "leave coordinates untouched"
 * — either because the caller already supplied explicit coordinates (their
 * own pin always wins, never overwritten by a geocode), or because there is
 * no address material to geocode. Otherwise delegates to `geocodeAddress`.
 */
export async function resolveCoordinates(
  input: ResolveCoordinatesInput,
): Promise<Coordinates | null> {
  if (input.lat != null && input.lon != null) return null;
  return geocodeAddress(input);
}
