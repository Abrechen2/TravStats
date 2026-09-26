/**
 * External port geocoding fallback.
 *
 * The local port catalog (vendored CSV + user-added ports) cannot cover every
 * cruise port on earth — e.g. Taranto was missing entirely. When the local
 * /ports search comes up empty, the frontend falls back to this geocoder so a
 * user can still find and add an arbitrary place (with real coordinates)
 * instead of typing lat/lon by hand.
 *
 * Backed by OpenStreetMap Nominatim (no API key). Nominatim is authoritative
 * for place names — Photon was evaluated but returned noise for ambiguous
 * names (a "Kusadasi" in France). Nominatim's usage policy requires a
 * descriptive User-Agent and ≤1 request/second, so this module throttles
 * globally and caches results in-memory.
 */
import logger from "../utils/logger";

export interface GeocodedPort {
  name: string;
  city: string | null;
  country: string | null;
  lat: number;
  lon: number;
  /** Marks results that came from the external geocoder (not the local DB). */
  source: "geocoder";
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "TravStats/2.0 (self-hosted travel logbook; +https://travstats.de)";
const REQUEST_TIMEOUT_MS = 8000;
const MIN_INTERVAL_MS = 1100; // honour Nominatim's ≤1 req/s policy
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // a place's coordinates don't move

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  address?: NominatimAddress;
}

const cache = new Map<string, { at: number; ports: GeocodedPort[] }>();
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function placeName(r: NominatimResult): string {
  const a = r.address ?? {};
  return (
    r.name ||
    a.city ||
    a.town ||
    a.village ||
    a.municipality ||
    a.county ||
    (r.display_name ? r.display_name.split(",")[0]?.trim() : undefined) ||
    "Unknown"
  );
}

function toPort(r: NominatimResult): GeocodedPort | null {
  const lat = Number.parseFloat(r.lat);
  const lon = Number.parseFloat(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const a = r.address ?? {};
  return {
    name: placeName(r),
    city: a.city ?? a.town ?? a.village ?? a.municipality ?? null,
    country: a.country ?? null,
    lat,
    lon,
    source: "geocoder",
  };
}

/**
 * Why a geocode produced no candidates although it may have had some.
 * `rate_limited` = Nominatim answered 429 (its 1 req/s policy, or a shared
 * egress IP); `unavailable` = any other failure (network, timeout, 5xx,
 * malformed body). A stable code, mapped to copy in the UI.
 */
export type PortGeocodeFailure = "rate_limited" | "unavailable";

export interface PortGeocodeOutcome {
  ports: GeocodedPort[];
  /** null = the geocoder answered; an empty `ports` then really means "no match". */
  failure: PortGeocodeFailure | null;
}

/**
 * Geocode a free-text place name into candidate ports.
 *
 * A failure is REPORTED, not folded into an empty list: before 2026-09-26 a
 * Nominatim 429 came back as "no candidates", and the picker offered only
 * "add the port by hand" with no hint that the lookup had not happened at
 * all. Failures are never cached, so the next keystroke tries again.
 */
export async function geocodePort(query: string, limit = 5): Promise<PortGeocodeOutcome> {
  const q = query.trim();
  if (q.length < 2) return { ports: [], failure: null };

  const key = q.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS)
    return { ports: cached.ports, failure: null };

  try {
    await throttle();
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=${limit}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let raw: unknown;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "de,en" },
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn({ status: res.status, q }, "[Port Geocoder] Nominatim non-OK response");
        return { ports: [], failure: res.status === 429 ? "rate_limited" : "unavailable" };
      }
      raw = await res.json();
    } finally {
      clearTimeout(timer);
    }

    if (!Array.isArray(raw)) {
      logger.warn({ q }, "[Port Geocoder] Nominatim answered with a non-array body");
      return { ports: [], failure: "unavailable" };
    }
    const ports = (raw as NominatimResult[])
      .map(toPort)
      .filter((p): p is GeocodedPort => p !== null);

    // Drop near-duplicate coordinates (Nominatim often returns the boundary +
    // the city point for the same place).
    const seen = new Set<string>();
    const deduped = ports.filter((p) => {
      const sig = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });

    cache.set(key, { at: Date.now(), ports: deduped });
    return { ports: deduped, failure: null };
  } catch (err) {
    logger.warn({ err, q }, "[Port Geocoder] geocode failed");
    return { ports: [], failure: "unavailable" };
  }
}

/** Test seam: forget cached lookups and the throttle clock. */
export function resetPortGeocoderForTests(): void {
  cache.clear();
  lastRequestAt = 0;
}
