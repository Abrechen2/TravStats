/**
 * Sea-route distance: the length of the line the map draws.
 *
 * The cruise map draws every computed leg from `computeSchematicRoute`
 * (`services/cruise/cruiseGeometry.ts`). The distance used to come from a
 * SECOND reading of the same marnet network (`marnetCalculator`), which
 * declined any route within 15 % of the chord and handed the leg to the
 * haversine fallback. The demo MSC cruise showed what that costs: four of
 * seven legs labelled "Luftlinie" and measured as the chord, while
 * `/geometry` reported `maritime_graph` for all seven and the map drew sea
 * routes around Corsica and through the Strait of Messina (acceptance run,
 * 2026-09-26). Measured on those legs, the drawn route is also the better
 * number — Genoa -> Civitavecchia: chord 347 km, drawn route 381 km, the
 * published sailing distance about 380 km.
 *
 * So a leg the router could route is measured along exactly that route, and
 * a leg it could not route ("direct") declines here and falls through to the
 * chord — which is then also what the map draws. Label, distance and picture
 * come from one result.
 */

import { polylineLengthKm } from "../../shared/geo/haversine";
import { computeSchematicRoute, type SchematicRoute } from "../schematicRouter";
import type { ComputedLeg, Confidence, DistanceCalculator, PortPoint } from "./types";

const ROUTER_VERSION = "2.0.0";

/** The coarse 1° grid is a last resort; the network and short hops are not. */
function confidenceOf(method: SchematicRoute["method"]): Confidence {
  return method === "coarse_a_star" ? "medium" : "high";
}

function isInlandPort(port: PortPoint): boolean {
  // River ports are measured by the river calculator, ahead in the chain.
  return port.region?.startsWith("river_") === true;
}

export const seaRouteCalculator: DistanceCalculator = {
  method: "eurostat",
  routerVersion: ROUTER_VERSION,

  accepts(from: PortPoint, to: PortPoint): boolean {
    if (isInlandPort(from) || isInlandPort(to)) return false;
    // The network loads a large GeoJSON; suites that create cruises by the
    // hundred measure chords instead, as they did under marnetCalculator.
    if (process.env.NODE_ENV === "test") return false;
    return true;
  },

  async compute(from: PortPoint, to: PortPoint): Promise<ComputedLeg | null> {
    const route = await computeSchematicRoute(from, to);
    if (!route.routed || route.waypoints.length < 2) return null;
    return {
      distanceKm: polylineLengthKm(route.waypoints.map(([lon, lat]) => ({ lat, lon }))),
      method: "eurostat",
      routerVersion: ROUTER_VERSION,
      dataVersion: null,
      confidence: confidenceOf(route.method),
      notes: route.method,
    };
  },
};
