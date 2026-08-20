/**
 * Photon (komoot) place-search service — powers search-as-you-type in
 * `LocationInput` (Task 3). Photon, unlike Nominatim, has no documented
 * per-second usage policy, which is exactly why it — not Nominatim — is the
 * one wired up for debounced typeahead (see the plan's global constraints).
 *
 * Never throws: every failure path degrades to `[]` so a flaky/misconfigured
 * geocoder never blocks the form. Mirrors the hard-deadline +
 * never-log-the-raw-body discipline established in
 * `services/lodging/mappingSuggestion.ts`.
 */
import { z } from "zod";
import { formatStreetAddress } from "./streetAddress";
import {
  resolveGeocoderUrls,
  DEFAULT_PHOTON_URL,
} from "../instanceSettingsService";
import logger from "../../utils/logger";

const DEFAULT_LIMIT = 6;

// Identify ourselves like `portGeocoder.ts` does. The previous fetch sent NO
// headers at all — an anonymous, UA-less request from every self-hosted
// instance is exactly the traffic public OSM infrastructure blanket-blocks,
// and a blocked instance showed nothing but "no results" (#263).
const USER_AGENT = "TravStats/2.0 (self-hosted travel logbook; +https://travstats.de)";

// Deliberately short — this backs live search-as-you-type, so the user gets
// "no results yet" far sooner than a stalled spinner. Overridable via
// `PHOTON_SEARCH_TIMEOUT_MS` (test-only escape hatch; production always gets
// the default). Mirrors `getSuggestTimeoutMs` in `mappingSuggestion.ts`.
const DEFAULT_TIMEOUT_MS = 8_000;

// Photon results are a small GeoJSON FeatureCollection — cap generously so a
// misbehaving/misconfigured instance (self-hosted URLs are admin-settable)
// can never make us buffer or parse an unbounded payload. Overridable via
// `PHOTON_SEARCH_MAX_BYTES` for tests only.
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;

function getSearchTimeoutMs(): number {
  const raw = process.env.PHOTON_SEARCH_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function getMaxResponseBytes(): number {
  const raw = process.env.PHOTON_SEARCH_MAX_BYTES;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_RESPONSE_BYTES;
}

export interface PlaceResult {
  name: string;
  address?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  lat: number;
  lon: number;
  type?: string;
}

export interface SearchPlacesOptions {
  limit?: number;
  lang?: string;
}

/**
 * `degraded: true` means the geocoder FAILED (unreachable, blocked, bad
 * response) — as opposed to a healthy "genuinely no matches". The route
 * forwards the flag so the UI can say "search is unavailable" instead of
 * the misleading "no results" (#263: a self-hoster whose egress was blocked
 * had no signal anywhere in the product).
 */
export interface PlaceSearchOutcome {
  results: PlaceResult[];
  degraded: boolean;
}

// Photon's actual GeoJSON carries many more properties than we consume —
// every field here is optional/passthrough so an unrelated Photon response
// change never trips validation; we only ever read the fields we normalize.
const photonFeatureSchema = z
  .object({
    properties: z
      .object({
        name: z.string().optional(),
        street: z.string().optional(),
        housenumber: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        countrycode: z.string().optional(),
        osm_value: z.string().optional(),
        type: z.string().optional(),
      })
      .passthrough()
      .optional(),
    geometry: z
      .object({
        coordinates: z.array(z.number()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const photonResponseSchema = z
  .object({
    features: z.array(photonFeatureSchema).optional(),
  })
  .passthrough();

type PhotonFeature = z.infer<typeof photonFeatureSchema>;
type PhotonProperties = NonNullable<PhotonFeature["properties"]>;

function buildAddress(props: PhotonProperties): string | undefined {
  // Order by country, not by our own habit: "50 Southwest Morrison Street", not
  // "Southwest Morrison Street 50". See services/geo/streetAddress.ts.
  return formatStreetAddress(props.street, props.housenumber, props.countrycode);
}

/**
 * Normalize one Photon feature. Returns `null` (skip) for anything missing a
 * name or a valid `[lon, lat]` coordinate pair — a malformed feature is
 * dropped rather than surfaced with garbage fields.
 */
function normalizeFeature(feature: PhotonFeature): PlaceResult | null {
  const props = feature.properties;
  const coords = feature.geometry?.coordinates;
  if (!props?.name) return null;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  // GeoJSON order is [lon, lat] — NOT [lat, lon].
  const [lon, lat] = coords;
  if (typeof lon !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  return {
    name: props.name,
    address: buildAddress(props),
    city: props.city,
    country: props.country,
    countryCode: props.countrycode,
    lat,
    lon,
    type: props.osm_value ?? props.type,
  };
}

/**
 * Parse a JSON string without ever surfacing the source text: a raw
 * `SyntaxError.message` can embed a snippet of the offending input, which
 * would leak third-party response content into the logs. Mirrors
 * `safeJsonParse` in `mappingSuggestion.ts`.
 */
const PARSE_FAILED = Symbol("photon-search-parse-failed");

function safeJsonParse(text: string): unknown | typeof PARSE_FAILED {
  try {
    return JSON.parse(text);
  } catch {
    return PARSE_FAILED;
  }
}

/**
 * Search Photon for places matching free text. **Never throws.** Every
 * failure path — unreachable, non-200, oversized response, invalid JSON, or
 * a response shape that fails schema validation — degrades to `[]` and logs
 * a stage-tagged warning (never the raw body, since it's third-party
 * content). Uses a hard deadline via `AbortSignal.timeout`: a real
 * wall-clock timeout that does NOT reset on socket activity, unlike
 * `req.setTimeout()`'s idle-timer behaviour (the lesson from the Task-10
 * lodging-mapping timeout work).
 */
type FetchOutcome =
  | { ok: true; results: PlaceResult[] }
  | { ok: false; stage: "http_status" | "size_cap" | "invalid_json" | "schema" | "network" };

async function fetchPhoton(url: string, limit: number): Promise<FetchOutcome> {
  const maxBytes = getMaxResponseBytes();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(getSearchTimeoutMs()),
    });

    if (!res.ok) {
      logger.warn(
        {
          operation: "photon_search_failed",
          stage: "http_status",
          status: res.status,
        },
        "[Photon] non-OK response — degrading to empty result",
      );
      return { ok: false, stage: "http_status" };
    }

    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      logger.warn(
        { operation: "photon_search_failed", stage: "size_cap" },
        "[Photon] response exceeded size cap — degrading to empty result",
      );
      return { ok: false, stage: "size_cap" };
    }

    const text = await res.text();
    if (Buffer.byteLength(text) > maxBytes) {
      logger.warn(
        { operation: "photon_search_failed", stage: "size_cap" },
        "[Photon] response exceeded size cap — degrading to empty result",
      );
      return { ok: false, stage: "size_cap" };
    }

    const json = safeJsonParse(text);
    if (json === PARSE_FAILED) {
      logger.warn(
        { operation: "photon_search_failed", stage: "invalid_json" },
        "[Photon] response was not valid JSON — degrading to empty result",
      );
      return { ok: false, stage: "invalid_json" };
    }

    const parsed = photonResponseSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn(
        { operation: "photon_search_failed", stage: "schema" },
        "[Photon] response failed schema validation — degrading to empty result",
      );
      return { ok: false, stage: "schema" };
    }

    const features = parsed.data.features ?? [];
    const results: PlaceResult[] = [];
    for (const feature of features) {
      const normalized = normalizeFeature(feature);
      if (normalized) results.push(normalized);
      if (results.length >= limit) break;
    }
    return { ok: true, results };
  } catch (error) {
    logger.warn(
      {
        operation: "photon_search_failed",
        stage: "network",
        error: error instanceof Error ? error.message : String(error),
      },
      "[Photon] search failed — degrading to empty result",
    );
    return { ok: false, stage: "network" };
  }
}

/**
 * Like `searchPlaces`, but distinguishes "no matches" from "the geocoder
 * failed" via `degraded`. Also owns two robustness moves (#263):
 *
 * - An admin-entered base URL that already ends in `/api` used to become
 *   `/api/api/?` → 404 → silently empty; the trailing segment is stripped.
 * - The public Photon rejects unsupported `lang` values with an HTTP error
 *   (it supports only a handful of languages), so a UI language like `pt`
 *   made EVERY search fail while the lang-less "Verbindung testen" stayed
 *   green. An HTTP-level failure with a lang set is retried once without it.
 */
export async function searchPlacesDetailed(
  query: string,
  options?: SearchPlacesOptions,
): Promise<PlaceSearchOutcome> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return { results: [], degraded: false };

  const limit = options?.limit ?? DEFAULT_LIMIT;

  let photonUrl = DEFAULT_PHOTON_URL;
  try {
    const settings = await resolveGeocoderUrls();
    photonUrl = settings.photonUrl;
  } catch (error) {
    // resolveGeocoderUrls() already applies DB > ENV > default internally,
    // so a rejection means the DB read itself failed — but the ENV tier is
    // still readable synchronously here. Honor it before falling all the way
    // to the public default (matters for air-gapped self-hosters during a
    // DB blip).
    photonUrl = process.env.PHOTON_URL ?? DEFAULT_PHOTON_URL;
    logger.warn(
      { error },
      "[Photon] failed to resolve geocoder settings, falling back to ENV/default URL",
    );
  }

  const baseUrl = photonUrl.replace(/\/+$/, "").replace(/\/api$/i, "");
  const params = new URLSearchParams({ q: trimmed, limit: String(limit) });
  if (options?.lang) params.set("lang", options.lang);
  const url = `${baseUrl}/api/?${params.toString()}`;

  const first = await fetchPhoton(url, limit);
  if (first.ok) return { results: first.results, degraded: false };

  if (options?.lang && first.stage === "http_status") {
    params.delete("lang");
    const retry = await fetchPhoton(`${baseUrl}/api/?${params.toString()}`, limit);
    if (retry.ok) return { results: retry.results, degraded: false };
  }

  return { results: [], degraded: true };
}

/**
 * Search Photon for places matching free text. **Never throws.** Every
 * failure path — unreachable, non-200, oversized response, invalid JSON, or
 * a response shape that fails schema validation — degrades to `[]` and logs
 * a stage-tagged warning (never the raw body, since it's third-party
 * content). Uses a hard deadline via `AbortSignal.timeout`: a real
 * wall-clock timeout that does NOT reset on socket activity, unlike
 * `req.setTimeout()`'s idle-timer behaviour (the lesson from the Task-10
 * lodging-mapping timeout work). Callers that need to tell a failure from
 * "no matches" use `searchPlacesDetailed` instead.
 */
export async function searchPlaces(
  query: string,
  options?: SearchPlacesOptions,
): Promise<PlaceResult[]> {
  const outcome = await searchPlacesDetailed(query, options);
  return outcome.results;
}
