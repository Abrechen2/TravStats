import {
  resolveGeocoderUrls,
  DEFAULT_NOMINATIM_URL,
} from "../instanceSettingsService";
import logger from "../../utils/logger";
import { formatStreetAddress } from "./streetAddress";
import { resolveCountryCode } from "../../shared/geo/countryCode";

// Nominatim's usage policy demands a descriptive UA and at most 1 req/s.
// The contact URL matters (#263): a contactless UA identical across every
// self-hosted instance is the signature OSM blanket-blocks. Mirrors
// `portGeocoder.ts`.
const USER_AGENT = "TravStats/2.0 (self-hosted travel logbook; +https://travstats.de)";
const MIN_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 5000;

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface GeocodeParts {
  /**
   * The place's own name ("Hotel Adlon Kempinski"). Used as the search subject
   * only when there is no street address — see `buildQuery`.
   */
  name?: string | null;
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

/** The subset of Nominatim's reverse `address` object this app fills in from. */
interface NominatimAddress {
  road?: unknown;
  house_number?: unknown;
  city?: unknown;
  town?: unknown;
  village?: unknown;
  municipality?: unknown;
  country?: unknown;
  /** ISO 3166-1 alpha-2, lowercase — decides whether the number leads the street. */
  country_code?: unknown;
}

interface NominatimReverseRow {
  display_name?: unknown;
  address?: NominatimAddress;
}

// Geocoding results for a given normalized query are stable for the process
// lifetime, so an unbounded cache is safe and small in practice. The key
// includes the resolved base URL so switching an instance's Nominatim
// target (self-hosted vs. public) never serves a stale cross-instance
// result out of the cache.
const cache = new Map<string, Coordinates | null>();

// Same reasoning as `cache`, for the opposite direction. Kept separate rather
// than sharing one map because the value shapes differ and a shared map would
// need a discriminator for no benefit.
const reverseCache = new Map<string, GeocodeParts | null>();

// Serializes every outbound request onto a single chain so concurrent saves
// cannot burst past Nominatim's 1 req/s limit — the throttle is process-wide,
// not per-call, because `queue` is reassigned to the tail of every request.
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

/**
 * The search subject is the STREET ADDRESS when there is one, and the place's
 * NAME otherwise.
 *
 * The name used to be ignored entirely, which broke exactly the input method
 * that depends on it: a parsed booking confirmation carries "Hotel Adlon
 * Kempinski" and a city but rarely a street, so the query collapsed to
 * "Berlin" — the city centre, not the hotel — or, with no city either, to the
 * empty string, which skips the lookup altogether. That is the "Email einlesen
 * hat die Koordinaten nicht aufgelöst" report of 2026-08-05.
 *
 * The name is deliberately NOT appended when a street address exists: a
 * precise address is the better search subject, and a generic name
 * ("Ferienwohnung", "Zuhause") would only add noise to a query that already
 * works.
 */
function buildQuery(parts: GeocodeParts): string {
  const address = parts.address?.trim();
  const subject = address || parts.name?.trim();
  return [subject, parts.city, parts.country]
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

async function fetchCoordinates(
  query: string,
  baseUrl: string,
): Promise<Coordinates | null> {
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
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
    logger.warn(
      { query, row: rows[0] },
      "geocoding response had unparseable coordinates",
    );
  }
  return coords;
}

/**
 * Resolve free-text address parts to coordinates via OSM Nominatim.
 * Never throws — every failure path (network error, non-OK, no result,
 * unparseable coordinates) logs a warning and resolves to `null` so a
 * lodging save is never blocked by a flaky or rate-limiting geocoder.
 */
export async function geocodeAddress(
  parts: GeocodeParts,
): Promise<Coordinates | null> {
  const query = buildQuery(parts);
  if (!query) return null;

  let nominatimUrl = DEFAULT_NOMINATIM_URL;
  try {
    const settings = await resolveGeocoderUrls();
    nominatimUrl = settings.nominatimUrl;
  } catch (error) {
    // resolveGeocoderUrls() already applies DB > ENV > default internally,
    // so a rejection means the DB read itself failed — but the ENV tier is
    // still readable synchronously here. Honor it before falling all the way
    // to the public default (matters for air-gapped self-hosters during a
    // DB blip).
    nominatimUrl = process.env.NOMINATIM_URL ?? DEFAULT_NOMINATIM_URL;
    logger.warn(
      { error },
      "failed to resolve geocoder settings, falling back to ENV/default URL",
    );
  }

  const baseUrl = nominatimUrl.replace(/\/+$/, "");
  const key = `${baseUrl}|${query.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  // Chain onto the shared queue so this call's request (and its throttle
  // wait) is serialized after every other in-flight/queued geocode call.
  const task = queue.then(async () => {
    await throttle();
    try {
      const coords = await fetchCoordinates(query, baseUrl);
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

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

async function fetchAddress(
  lat: number,
  lon: number,
  baseUrl: string,
): Promise<GeocodeParts | null> {
  const url =
    `${baseUrl}/reverse?lat=${encodeURIComponent(String(lat))}` +
    `&lon=${encodeURIComponent(String(lon))}&format=json&zoom=18&addressdetails=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    logger.warn({ lat, lon, status: res.status }, "reverse geocoding non-OK");
    return null;
  }
  const row = (await res.json()) as NominatimReverseRow;
  const a = row?.address;
  if (!a) {
    logger.warn({ lat, lon }, "reverse geocoding returned no address block");
    return null;
  }
  // Nominatim names the settlement differently by place type, so all four
  // spellings have to be consulted — a hotel in a village returns `village`
  // and no `city`, and dropping that would leave the field empty for exactly
  // the addresses hardest to type by hand.
  const city = str(a.city) ?? str(a.town) ?? str(a.village) ?? str(a.municipality);
  const road = str(a.road);
  const houseNumber = str(a.house_number);
  // Order by country, not by our own habit: "50 Southwest Morrison Street", not
  // "Southwest Morrison Street 50". See services/geo/streetAddress.ts.
  const address = formatStreetAddress(road, houseNumber, str(a.country_code)) ?? null;
  const parts: GeocodeParts = { address, city, country: str(a.country) };
  // All three empty is indistinguishable from "no answer" to every caller, so
  // report it as one rather than handing back a hollow object.
  if (!parts.address && !parts.city && !parts.country) return null;
  return parts;
}

/**
 * The opposite direction: coordinates -> address parts.
 *
 * Needed because a pin dropped on the map or a pasted coordinate pair is a
 * perfectly good way to enter a lodging, and used to leave address/city/country
 * empty forever — the location was found but never COMPLETED. Shares the same
 * process-wide queue, throttle and never-throws contract as `geocodeAddress`,
 * because it hits the same 1 req/s Nominatim budget.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<GeocodeParts | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  let nominatimUrl = DEFAULT_NOMINATIM_URL;
  try {
    const settings = await resolveGeocoderUrls();
    nominatimUrl = settings.nominatimUrl;
  } catch (error) {
    nominatimUrl = process.env.NOMINATIM_URL ?? DEFAULT_NOMINATIM_URL;
    logger.warn(
      { error },
      "failed to resolve geocoder settings, falling back to ENV/default URL",
    );
  }

  const baseUrl = nominatimUrl.replace(/\/+$/, "");
  // Rounded to ~11 m: a pin nudged by a few metres is the same address, and
  // without rounding the cache would miss on every drag.
  const key = `${baseUrl}|${lat.toFixed(4)},${lon.toFixed(4)}`;
  const cached = reverseCache.get(key);
  if (cached !== undefined) return cached;

  const task = queue.then(async () => {
    await throttle();
    try {
      const parts = await fetchAddress(lat, lon, baseUrl);
      reverseCache.set(key, parts);
      return parts;
    } catch (error) {
      // Transient (timeout, network blip) — deliberately NOT cached, so the
      // next save retries instead of being told "no address" for the process
      // lifetime.
      logger.warn({ error, lat, lon }, "reverse geocoding failed");
      return null;
    }
  });
  queue = task.catch(() => undefined);
  return task;
}

/**
 * Fill ONLY the address fields the caller left empty, from the coordinates.
 *
 * Never overwrites something the user typed — a hand-entered "Hotel Adlon,
 * Berlin" must survive even when Nominatim would phrase it differently. Returns
 * `null` when there is nothing to add, so callers can skip the write entirely.
 */
export async function completeAddressFromCoordinates(
  input: ResolveCoordinatesInput,
): Promise<GeocodeParts | null> {
  const { lat, lon } = input;
  if (lat == null || lon == null) return null;
  // A country field that names no country counts as missing. It is not empty —
  // an Armani confirmation prints "Burj Khalifa, Downtown Dubai" and never the
  // word "Emirates", so the field held "Dubai": a city, standing in the country
  // filter as its own country, with no flag and one country too many in every
  // count. The pin knew better all along.
  const countryIsNotACountry =
    Boolean(input.country?.trim()) && resolveCountryCode(input.country) === null;
  const missing =
    !input.address?.trim() || !input.city?.trim() || !input.country?.trim() || countryIsNotACountry;
  if (!missing) return null;

  const resolved = await reverseGeocode(lat, lon);
  if (resolved === null) return null;

  const filled: GeocodeParts = {};
  if (!input.address?.trim() && resolved.address) filled.address = resolved.address;
  if (!input.city?.trim() && resolved.city) filled.city = resolved.city;
  if ((!input.country?.trim() || countryIsNotACountry) && resolved.country)
    filled.country = resolved.country;
  return Object.keys(filled).length > 0 ? filled : null;
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
