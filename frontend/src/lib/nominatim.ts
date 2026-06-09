/**
 * Thin typed wrapper around OpenStreetMap's Nominatim search API.
 *
 * Nominatim usage policy — https://operations.osmfoundation.org/policies/nominatim/
 *   - Set a descriptive User-Agent on every request (browsers usually override
 *     this header, but we set it anyway so any server-side proxy / Node env
 *     passes a valid identifier). Missing UA can get the caller banned.
 *   - No more than 1 request per second per IP — the call site debounces input
 *     by 400 ms and aborts in-flight requests when a new query arrives, which
 *     keeps the outgoing rate well below that ceiling.
 *   - Always display the © OpenStreetMap contributors attribution near any UI
 *     that surfaces results.
 *
 * The wrapper returns a small, UI-friendly shape (`{ displayName, lat, lon }`)
 * and deliberately throws `NominatimError` for the caller to render a message.
 * Aborts (AbortError) propagate as-is so callers can silently ignore them.
 */
import { logger } from "./logger";

export interface NominatimPlace {
  displayName: string;
  lat: number;
  lon: number;
}

/** Raised for network / parse failures. Aborts are *not* wrapped in this. */
export class NominatimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NominatimError";
  }
}

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "TravStats/1.0 (github.com/abrechen2/travstats)";
const DEFAULT_LIMIT = 5;

/** Nominatim row shape — only the fields we actually use. */
interface NominatimRawHit {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
}

function parseCoord(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseHit(raw: unknown): NominatimPlace | null {
  if (typeof raw !== "object" || raw === null) return null;
  const hit = raw as NominatimRawHit;
  if (typeof hit.display_name !== "string") return null;
  const lat = parseCoord(hit.lat);
  const lon = parseCoord(hit.lon);
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { displayName: hit.display_name, lat, lon };
}

/**
 * Search Nominatim for up to `limit` places matching `query`.
 *
 * @param query      The free-form place name typed by the user. Whitespace is
 *                   trimmed; empty queries short-circuit to an empty array.
 * @param signal     Optional AbortSignal — forward the one you got from the
 *                   caller's debouncer / component unmount so the fetch is
 *                   cancelled cleanly on a fresh keystroke.
 * @param limit      How many hits to return (default 5, max clamped to 10).
 * @returns          A promise resolving to the parsed hits. Never null; empty
 *                   array on "no results".
 * @throws           `NominatimError` on network or decoding failure.
 *                   Forwards `DOMException` (AbortError) on cancellation so
 *                   callers can distinguish "cancelled" from "real failure".
 */
export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
  limit = DEFAULT_LIMIT
): Promise<NominatimPlace[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const safeLimit = Math.max(1, Math.min(10, Math.floor(limit)));
  const url = new URL(NOMINATIM_ENDPOINT);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", String(safeLimit));
  url.searchParams.set("q", trimmed);
  // Ask for structured address components — we don't parse them now but they
  // make future city/country fallbacks cheap.
  url.searchParams.set("addressdetails", "0");

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      signal,
      headers: {
        Accept: "application/json",
        // Browsers strip User-Agent overrides, but any Node-side or proxy
        // fetch will honour it. Setting it is explicitly required by the
        // Nominatim operators.
        "User-Agent": USER_AGENT,
      },
    });
  } catch (err) {
    // AbortError must bubble up unchanged so the caller can ignore it.
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    logger.warn("Nominatim fetch failed:", err);
    throw new NominatimError("Nominatim request failed");
  }

  if (!response.ok) {
    throw new NominatimError(`Nominatim responded with HTTP ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    logger.warn("Nominatim JSON parse failed:", err);
    throw new NominatimError("Invalid Nominatim response");
  }

  if (!Array.isArray(payload)) {
    throw new NominatimError("Nominatim returned a non-array payload");
  }

  const hits: NominatimPlace[] = [];
  for (const row of payload) {
    const parsed = parseHit(row);
    if (parsed) hits.push(parsed);
  }
  return hits;
}
