import logger from "../../../utils/logger";
import {
  isRoutableMode,
  RoutableMode,
  RouteFailure,
  RouteFallbackReason,
  RouteProvider,
  RouteRequest,
  RouteResult,
} from "./types";

/**
 * OpenRouteService adapter (https://openrouteservice.org/).
 *
 * Verified against the GeoJSON directions response shape as of 2026-08:
 * `POST /v2/directions/{profile}/geojson` — the profile goes in the URL
 * path, not the body. The body carries `coordinates` as `[[lon,lat], …]`.
 * The key goes in the `Authorization` header (raw value, no `Bearer`
 * prefix). The response is a FeatureCollection; this adapter only ever
 * reads `features[0]`:
 *   - `geometry.coordinates` — `[lon,lat]` pairs, GeoJSON order (matches
 *     `RouteResult.waypoints` directly, no reordering needed).
 *   - `properties.summary.distance` — metres.
 *   - `properties.summary.duration` — seconds.
 */

const ORS_BASE_URL = "https://api.openrouteservice.org/v2/directions";

/**
 * ORS's own profile vocabulary (verified via WebSearch against the ORS
 * community docs and the R client's `profiles.R`, which enumerates the full
 * profile list: `driving-car`, `driving-hgv`, `cycling-regular`,
 * `cycling-road`, `cycling-mountain`, `cycling-electric`, `foot-walking`,
 * `foot-hiking`, `wheelchair`).
 *
 * A road leg is `driving-car`. This used to be `driving-hgv` (the truck
 * profile) for every road leg, which routes a car around weight and height
 * limits it does not have and refuses roads a motorhome drives daily. The
 * truck profile would be right only for a large motorhome, and a roadtrip
 * records no vehicle size — so no vehicle earns it (2026-09-26). A foot leg
 * is `foot-hiking`, because a roadtrip's walks are trails more than
 * pavements; a bike leg is the plain `cycling-regular`.
 */
export const ORS_PROFILE_BY_MODE: Record<RoutableMode, string> = {
  road: "driving-car",
  foot: "foot-hiking",
  bike: "cycling-regular",
};

/** A road leg of a bicycle roadtrip is ridden; every other vehicle drives it. */
export function orsProfileFor(mode: RoutableMode, vehicle?: string | null): string {
  if (mode === "road" && vehicle === "bicycle") return ORS_PROFILE_BY_MODE.bike;
  return ORS_PROFILE_BY_MODE[mode];
}

/**
 * How far (metres) ORS may look for a routable point around each stop. Its
 * default is 350 m, and a campsite or a car park at the end of a track is
 * often further than that from the nearest mapped road — ORS then answers
 * 2010 and the leg stays a straight line. 1000 m is the ceiling that is
 * still useful: `routeLeg.ts` discards any line whose ends lie more than
 * 1 km (`ANCHOR_TOLERANCE_KM`) from its stops, so a wider snap would only
 * buy a route that is thrown away afterwards.
 */
export const ORS_SNAP_RADIUS_M = 1000;

/**
 * ORS's documented directions error codes that name a cause
 * (`error.code` in its JSON error body). Anything else is `provider_error`.
 */
const ORS_ERROR_REASON: Record<number, RouteFallbackReason> = {
  2004: "no_route", // the request exceeds the server's route limits
  2009: "no_route", // no route between the points
  2010: "point_not_near_road", // no routable point within the radius
};

/** What an ORS error body says, if it says anything readable. */
function readOrsError(body: unknown): { code: number | null; message: string | null } {
  if (typeof body !== "object" || body === null) return { code: null, message: null };
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return { code: null, message: error };
  if (typeof error !== "object" || error === null) return { code: null, message: null };
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return {
    code: typeof code === "number" ? code : null,
    message: typeof message === "string" ? message : null,
  };
}

/** Maps a non-2xx ORS answer to a fallback reason: the status first, then ORS's own code. */
export function orsFailureReason(status: number, code: number | null): RouteFallbackReason {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (code !== null && ORS_ERROR_REASON[code]) return ORS_ERROR_REASON[code];
  return "provider_error";
}

interface OrsGeoJsonResponse {
  features: Array<{
    geometry: { coordinates: Array<[number, number]> };
    properties: { summary: { distance: number; duration: number } };
  }>;
}

function isFiniteCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function isOrsGeoJsonResponse(value: unknown): value is OrsGeoJsonResponse {
  if (typeof value !== "object" || value === null) return false;
  const features = (value as { features?: unknown }).features;
  if (!Array.isArray(features) || features.length === 0) return false;

  const first = features[0];
  if (typeof first !== "object" || first === null) return false;

  const geometry = (first as { geometry?: unknown }).geometry;
  if (typeof geometry !== "object" || geometry === null) return false;
  const coordinates = (geometry as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0) return false;
  if (!coordinates.every(isFiniteCoordinatePair)) return false;

  const properties = (first as { properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return false;
  const summary = (properties as { summary?: unknown }).summary;
  if (typeof summary !== "object" || summary === null) return false;
  const distance = (summary as { distance?: unknown }).distance;
  const duration = (summary as { duration?: unknown }).duration;
  if (typeof distance !== "number" || !Number.isFinite(distance)) return false;
  if (typeof duration !== "number" || !Number.isFinite(duration)) return false;

  return true;
}

export function createOpenRouteService(
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): RouteProvider {
  return {
    id: "openrouteservice",
    async route(req: RouteRequest): Promise<RouteResult | RouteFailure | null> {
      if (!isRoutableMode(req.mode)) {
        return null;
      }
      const profile = orsProfileFor(req.mode, req.vehicle);
      const url = `${ORS_BASE_URL}/${profile}/geojson`;

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            coordinates: [
              [req.from.lon, req.from.lat],
              [req.to.lon, req.to.lat],
            ],
            radiuses: [ORS_SNAP_RADIUS_M, ORS_SNAP_RADIUS_M],
          }),
        });
      } catch (err) {
        logger.warn(
          { provider: "openrouteservice", error: err instanceof Error ? err.message : String(err) },
          "openrouteservice request failed"
        );
        return { failure: "provider_error" };
      }

      if (!response.ok) {
        // The error body names the cause (2010: no road near a stop, 2009: no
        // route). Logged with the status so a fallback can be told apart in
        // the log; the key travels in a header and never reaches this line.
        const { code, message } = readOrsError(await response.json().catch(() => null));
        const reason = orsFailureReason(response.status, code);
        logger.warn(
          {
            provider: "openrouteservice",
            status: response.status,
            profile,
            orsCode: code,
            orsMessage: message,
            reason,
          },
          "openrouteservice returned a non-200 response"
        );
        return { failure: reason };
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (_err) {
        logger.warn(
          { provider: "openrouteservice", status: response.status },
          "openrouteservice response body was not valid JSON"
        );
        return { failure: "provider_error" };
      }

      if (!isOrsGeoJsonResponse(body)) {
        logger.warn(
          { provider: "openrouteservice", status: response.status },
          "openrouteservice response did not match the expected shape"
        );
        return { failure: "provider_error" };
      }

      const feature = body.features[0];
      const summary = feature.properties.summary;
      return {
        waypoints: feature.geometry.coordinates.map(([lon, lat]) => [lon, lat]),
        distanceKm: summary.distance / 1000,
        drivingMinutes: summary.duration / 60,
      };
    },
  };
}
