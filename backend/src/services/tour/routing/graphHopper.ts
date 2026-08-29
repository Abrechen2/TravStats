import logger from "../../../utils/logger";
import { isRoutableMode, PROFILE_BY_MODE, RouteProvider, RouteRequest, RouteResult } from "./types";

/**
 * GraphHopper adapter (https://www.graphhopper.com/).
 *
 * Verified against the official routing API doc
 * (graphhopper/graphhopper docs/web/api-doc.md) as of 2026-08:
 *   - `GET /route`, points passed as repeated `point=lat,lon` query params
 *     (GraphHopper uses lat,lon order here — the OPPOSITE of ORS/OSRM, which
 *     is why the request builder below is explicit about it).
 *   - `profile` query param selects the vehicle profile.
 *   - `points_encoded=false` is required or `paths[0].points` comes back as
 *     an encoded polyline string that would need a separate decoder; with
 *     it set, `points` is GeoJSON-shaped:
 *     `{ type: "LineString", coordinates: [[lon,lat,elevation], …] }`.
 *   - `paths[0].distance` — metres.
 *   - `paths[0].time` — MILLISECONDS, not seconds (confirmed in the doc:
 *     "The total time of the route, in ms"). This is the one unit that
 *     differs from the other two providers and is easy to get wrong.
 */

const GRAPHHOPPER_BASE_URL = "https://graphhopper.com/api/1/route";

interface GraphHopperResponse {
  paths: Array<{
    points: { coordinates: Array<[number, number, ...number[]]> };
    distance: number;
    time: number;
  }>;
}

function isFiniteCoordinateTuple(value: unknown): value is [number, number, ...number[]] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function isGraphHopperResponse(value: unknown): value is GraphHopperResponse {
  if (typeof value !== "object" || value === null) return false;
  const paths = (value as { paths?: unknown }).paths;
  if (!Array.isArray(paths) || paths.length === 0) return false;

  const first = paths[0];
  if (typeof first !== "object" || first === null) return false;

  const points = (first as { points?: unknown }).points;
  if (typeof points !== "object" || points === null) return false;
  const coordinates = (points as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0) return false;
  if (!coordinates.every(isFiniteCoordinateTuple)) return false;

  const distance = (first as { distance?: unknown }).distance;
  const time = (first as { time?: unknown }).time;
  if (typeof distance !== "number" || !Number.isFinite(distance)) return false;
  if (typeof time !== "number" || !Number.isFinite(time)) return false;

  return true;
}

export function createGraphHopper(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): RouteProvider {
  return {
    id: "graphhopper",
    async route(req: RouteRequest): Promise<RouteResult | null> {
      if (!isRoutableMode(req.mode)) {
        return null;
      }
      const profile = PROFILE_BY_MODE[req.mode];
      const params = new URLSearchParams();
      params.append("point", `${req.from.lat},${req.from.lon}`);
      params.append("point", `${req.to.lat},${req.to.lon}`);
      params.append("profile", profile);
      params.append("points_encoded", "false");
      params.append("key", apiKey);
      const url = `${GRAPHHOPPER_BASE_URL}?${params.toString()}`;

      let response: Response;
      try {
        response = await fetchImpl(url);
      } catch (err) {
        logger.warn(
          { provider: "graphhopper", error: err instanceof Error ? err.message : String(err) },
          "graphhopper request failed",
        );
        return null;
      }

      if (!response.ok) {
        logger.warn(
          { provider: "graphhopper", status: response.status },
          "graphhopper returned a non-200 response",
        );
        return null;
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (_err) {
        logger.warn(
          { provider: "graphhopper", status: response.status },
          "graphhopper response body was not valid JSON",
        );
        return null;
      }

      if (!isGraphHopperResponse(body)) {
        logger.warn(
          { provider: "graphhopper", status: response.status },
          "graphhopper response did not match the expected shape",
        );
        return null;
      }

      const path = body.paths[0];
      return {
        waypoints: path.points.coordinates.map(([lon, lat]) => [lon, lat]),
        distanceKm: path.distance / 1000,
        drivingMinutes: path.time / 1000 / 60,
      };
    },
  };
}
