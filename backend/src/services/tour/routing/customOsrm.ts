import logger from "../../../utils/logger";
import { isRoutableMode, RoutableMode, RouteProvider, RouteRequest, RouteResult } from "./types";

/**
 * Custom/self-hosted OSRM adapter (http://project-osrm.org/).
 *
 * Verified against the OSRM HTTP API docs as of 2026-08:
 *   - `GET /route/v1/{profile}/{lon},{lat};{lon},{lat}?geometries=geojson&overview=full`
 *   - No API key — a self-hosted OSRM instance has none. `baseUrl` is the
 *     admin-configured instance root (e.g. `http://osrm.local:5000`), which
 *     may itself carry a path and/or a query string (e.g. a reverse proxy
 *     in front of OSRM that expects `?token=...` on every request) — see
 *     the URL-building note below.
 *   - `routes[0].geometry.coordinates` — `[lon,lat]` pairs, GeoJSON order.
 *   - `routes[0].distance` — metres.
 *   - `routes[0].duration` — seconds.
 *
 * Scope note: this targets OSRM only. Valhalla speaks a different protocol
 * (a `/route` POST with a JSON body, `trip`/`legs`/`shape` response shaped
 * as an encoded polyline, distances in the configured unit rather than a
 * fixed metric) — this adapter does not attempt to speak both. A
 * self-hosted Valhalla instance is not a supported "custom" backend here.
 */

/**
 * There is no single OSRM profile vocabulary the way ORS and GraphHopper
 * each have one fixed list — a self-hosted OSRM instance's profile names are
 * whatever the operator's `.lua` files were called when the graph was built
 * (`osrm-extract --profile <name>.lua`). These three defaults match OSRM's
 * own out-of-the-box profile filenames (`car.lua`, `foot.lua`,
 * `bicycle.lua` — confirmed via `docs/profiles.md` in
 * Project-OSRM/osrm-backend), which is the closest thing to a documented
 * convention for an instance that has not renamed them. An operator who DID
 * rename their profiles needs a differently-configured "custom" adapter —
 * out of scope here, and called out so it is not mistaken for a guarantee.
 */
export const OSRM_PROFILE_BY_MODE: Record<RoutableMode, string> = {
  road: "car",
  foot: "foot",
  bike: "bicycle",
};

interface OsrmResponse {
  routes: Array<{
    geometry: { coordinates: Array<[number, number]> };
    distance: number;
    duration: number;
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

function isOsrmResponse(value: unknown): value is OsrmResponse {
  if (typeof value !== "object" || value === null) return false;
  const routes = (value as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || routes.length === 0) return false;

  const first = routes[0];
  if (typeof first !== "object" || first === null) return false;

  const geometry = (first as { geometry?: unknown }).geometry;
  if (typeof geometry !== "object" || geometry === null) return false;
  const coordinates = (geometry as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0) return false;
  if (!coordinates.every(isFiniteCoordinatePair)) return false;

  const distance = (first as { distance?: unknown }).distance;
  const duration = (first as { duration?: unknown }).duration;
  if (typeof distance !== "number" || !Number.isFinite(distance)) return false;
  if (typeof duration !== "number" || !Number.isFinite(duration)) return false;

  return true;
}

export function createCustomOsrm(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): RouteProvider {
  // Parsed eagerly: a baseUrl that isn't a valid absolute URL fails clearly
  // and immediately at configuration time (URL's own descriptive error),
  // rather than producing a silently-broken request string on the first
  // route() call. A base URL that DOES parse but already carries a path
  // and/or a query string (a reverse proxy in front of a self-hosted OSRM,
  // with e.g. `?token=...`) is the case this adapter must not break: the
  // route path is appended to the existing path, and the existing query
  // string is preserved alongside `geometries`/`overview` below — never
  // simply concatenated with `?`, which would either double up `?` or drop
  // the operator's own query string entirely.
  const base = new URL(baseUrl);
  const basePath = base.pathname.replace(/\/+$/, "");

  return {
    id: "custom",
    async route(req: RouteRequest): Promise<RouteResult | null> {
      if (!isRoutableMode(req.mode)) {
        return null;
      }
      const profile = OSRM_PROFILE_BY_MODE[req.mode];
      const coordinates = `${req.from.lon},${req.from.lat};${req.to.lon},${req.to.lat}`;

      const url = new URL(base.toString());
      url.pathname = `${basePath}/route/v1/${profile}/${coordinates}`;
      url.searchParams.set("geometries", "geojson");
      url.searchParams.set("overview", "full");

      let response: Response;
      try {
        response = await fetchImpl(url.toString());
      } catch (err) {
        logger.warn(
          { provider: "custom", error: err instanceof Error ? err.message : String(err) },
          "custom OSRM request failed",
        );
        return null;
      }

      if (!response.ok) {
        logger.warn(
          { provider: "custom", status: response.status },
          "custom OSRM returned a non-200 response",
        );
        return null;
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (_err) {
        logger.warn(
          { provider: "custom", status: response.status },
          "custom OSRM response body was not valid JSON",
        );
        return null;
      }

      if (!isOsrmResponse(body)) {
        logger.warn(
          { provider: "custom", status: response.status },
          "custom OSRM response did not match the expected shape",
        );
        return null;
      }

      const route = body.routes[0];
      return {
        waypoints: route.geometry.coordinates.map(([lon, lat]) => [lon, lat]),
        distanceKm: route.distance / 1000,
        drivingMinutes: route.duration / 60,
      };
    },
  };
}
