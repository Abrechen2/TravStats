import logger from "../../../utils/logger";
import { isRoutableMode, PROFILE_BY_MODE, RouteProvider, RouteRequest, RouteResult } from "./types";

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
  fetchImpl: typeof fetch = fetch,
): RouteProvider {
  return {
    id: "openrouteservice",
    async route(req: RouteRequest): Promise<RouteResult | null> {
      if (!isRoutableMode(req.mode)) {
        return null;
      }
      const profile = PROFILE_BY_MODE[req.mode];
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
          }),
        });
      } catch (err) {
        logger.warn(
          { provider: "openrouteservice", error: err instanceof Error ? err.message : String(err) },
          "openrouteservice request failed",
        );
        return null;
      }

      if (!response.ok) {
        logger.warn(
          { provider: "openrouteservice", status: response.status },
          "openrouteservice returned a non-200 response",
        );
        return null;
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (_err) {
        logger.warn(
          { provider: "openrouteservice", status: response.status },
          "openrouteservice response body was not valid JSON",
        );
        return null;
      }

      if (!isOrsGeoJsonResponse(body)) {
        logger.warn(
          { provider: "openrouteservice", status: response.status },
          "openrouteservice response did not match the expected shape",
        );
        return null;
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
