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
 * descriptive User-Agent and ≤1 request/second. The request itself goes through
 * `geo/nominatim.ts` — the instance's configured Nominatim URL and its one
 * shared 1 req/s queue (forgejo#359) — and results are cached in-memory, capped.
 */
import logger from "../utils/logger";
import { LruMap } from "../utils/lruMap";
import { GeocoderHttpError, resetNominatimThrottleForTests, searchPlaces } from "./geo/nominatim";

export interface GeocodedPort {
  name: string;
  city: string | null;
  country: string | null;
  lat: number;
  lon: number;
  /** Marks results that came from the external geocoder (not the local DB). */
  source: "geocoder";
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // a place's coordinates don't move
const CACHE_MAX_ENTRIES = 500;

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

const cache = new LruMap<string, { at: number; ports: GeocodedPort[] }>(CACHE_MAX_ENTRIES);

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
    let raw: unknown;
    try {
      raw = await searchPlaces(q, limit);
    } catch (err) {
      if (err instanceof GeocoderHttpError) {
        logger.warn({ status: err.status }, "[Port Geocoder] Nominatim non-OK response");
        logger.debug({ status: err.status, q }, "[Port Geocoder] Nominatim non-OK response");
        return { ports: [], failure: err.status === 429 ? "rate_limited" : "unavailable" };
      }
      throw err;
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
    logger.warn({ err }, "[Port Geocoder] geocode failed");
    logger.debug({ q }, "[Port Geocoder] geocode failed");
    return { ports: [], failure: "unavailable" };
  }
}

/** Test seam: forget cached lookups and the throttle clock. */
export function resetPortGeocoderForTests(): void {
  cache.clear();
  resetNominatimThrottleForTests();
}
