import { seaRoute } from "searoute-ts";
import type { RouteMethod, LonLat } from "../types";
import { polylineLengthKm } from "../geo";

/**
 * searoute-ts: pre-baked maritime network from Eurostat's Java lib,
 * ported to TS by mayurrawte. Uses a Dijkstra over a real shipping-
 * lane graph (nodes at canals, straits, major ports) rather than a
 * raster grid. Typically produces the cleanest visuals because the
 * graph itself is tuned to look like what a human would draw.
 *
 * Accepts GeoJSON Feature<Point> in and returns Feature<LineString>.
 * If the origin/destination is on land the library snaps to the
 * nearest sea node, same flavour as our A* port-snap.
 */
export const searouteTsMethod: RouteMethod = {
  id: "searoute-ts",
  label: "searoute-ts (pre-baked graph)",
  color: "#fb923c",
  description: "Eurostat's maritime graph + Dijkstra. Real shipping-lane nodes.",
  defaultOn: true,
  compute: async (pair) => {
    const t0 = performance.now();
    const origin = {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [pair.from.lon, pair.from.lat] },
    };
    const destination = {
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [pair.to.lon, pair.to.lat] },
    };
    try {
      const feature = seaRoute(origin, destination, "kilometers");
      const coords = (feature.geometry.coordinates as number[][]).map(
        ([lon, lat]) => [lon, lat] as LonLat,
      );
      const reportedKm =
        typeof feature.properties?.length === "number"
          ? (feature.properties.length as number)
          : polylineLengthKm(coords);
      return {
        coordinates: coords,
        distanceKm: reportedKm,
        computeMs: performance.now() - t0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        coordinates: [
          [pair.from.lon, pair.from.lat],
          [pair.to.lon, pair.to.lat],
        ],
        distanceKm: 0,
        computeMs: performance.now() - t0,
        note: `searoute failed: ${msg.slice(0, 80)}`,
      };
    }
  },
};
