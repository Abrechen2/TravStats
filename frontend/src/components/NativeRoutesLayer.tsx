/**
 * WebGL1-compatible fallback for flight route rendering.
 * Uses MapLibre's native GeoJSON source + line/circle layers
 * instead of deck.gl (which requires WebGL2).
 *
 * Usage: render inside <Map> and pass interactiveLayerIds to <Map>.
 * Handle clicks via <Map onClick> by checking e.features layer id.
 */
import { useMemo } from "react";
import { Source, Layer } from "react-map-gl/maplibre";
import type { LineLayerSpecification, CircleLayerSpecification } from "maplibre-gl";
import type { GeoJSONFeature } from "../types";

/** Layer IDs exported so DeckGLMap can register them as interactive */
export const NATIVE_ROUTE_LINE_ID = "native-routes-line";
export const NATIVE_AIRPORT_CIRCLE_ID = "native-airports-circle";
export const NATIVE_AIRPORT_LABEL_ID = "native-airports-label";

interface NativeRoutesLayerProps {
  flights: GeoJSONFeature[];
  minRouteCount: number;
  selectedIds: string[];
}

interface RouteFeature {
  type: "Feature";
  properties: {
    routeKey: string;
    count: number;
    flightIds: string;
    isScheduled: boolean;
    isHistorical: boolean;
    isSelected: boolean;
  };
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
}

interface AirportFeature {
  type: "Feature";
  properties: {
    iata: string;
    name: string;
    count: number;
  };
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
}

function routeKey(a: string, b: string): string {
  return [a, b].sort().join("-");
}

/** Generate great circle intermediate points for smoother curves. */
function greatCirclePoints(
  start: [number, number],
  end: [number, number],
  segments: number = 50
): [number, number][] {
  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const [lon1, lat1] = [start[0] * toRad, start[1] * toRad];
  const [lon2, lat2] = [end[0] * toRad, end[1] * toRad];

  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2
      )
    );

  if (d < 1e-10) return [start, end];

  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    points.push([Math.atan2(y, x) * toDeg, Math.atan2(z, Math.sqrt(x * x + y * y)) * toDeg]);
  }
  return points;
}

export function useNativeRouteData(
  flights: GeoJSONFeature[],
  minRouteCount: number,
  selectedIds: string[]
): {
  routeGeoJSON: GeoJSON.FeatureCollection;
  airportGeoJSON: GeoJSON.FeatureCollection;
} {
  return useMemo(() => {
    const routeCounts = new Map<string, number>();
    const routeFlightIds = new Map<string, string[]>();
    const routeCoords = new Map<string, { dep: [number, number]; arr: [number, number] }>();
    const routeStatus = new Map<string, { scheduled: number; historical: number; total: number }>();
    const airportMap = new Map<string, AirportFeature>();
    const selectedSet = new Set(selectedIds);

    for (const f of flights) {
      const dep = f.properties.departureAirport;
      const arr = f.properties.arrivalAirport;
      const coords = f.geometry.coordinates;
      if (!dep.iata || !arr.iata || !coords || coords.length < 2) continue;

      const depCoord = coords[0] as [number, number];
      const arrCoord = coords[coords.length - 1] as [number, number];
      const key = routeKey(dep.iata, arr.iata);

      routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);
      const ids = routeFlightIds.get(key) ?? [];
      ids.push(f.properties.id);
      routeFlightIds.set(key, ids);

      if (!routeCoords.has(key)) {
        routeCoords.set(key, { dep: depCoord, arr: arrCoord });
      }

      const status = routeStatus.get(key) ?? { scheduled: 0, historical: 0, total: 0 };
      status.total++;
      if (f.properties.status === "scheduled") status.scheduled++;
      if (f.properties.status === "historical") status.historical++;
      routeStatus.set(key, status);

      if (!airportMap.has(dep.iata)) {
        airportMap.set(dep.iata, {
          type: "Feature",
          properties: { iata: dep.iata, name: dep.name ?? dep.iata, count: 0 },
          geometry: { type: "Point", coordinates: depCoord },
        });
      }
      if (!airportMap.has(arr.iata)) {
        airportMap.set(arr.iata, {
          type: "Feature",
          properties: { iata: arr.iata, name: arr.name ?? arr.iata, count: 0 },
          geometry: { type: "Point", coordinates: arrCoord },
        });
      }
      const dp = airportMap.get(dep.iata)!;
      airportMap.set(dep.iata, {
        ...dp,
        properties: { ...dp.properties, count: dp.properties.count + 1 },
      });
      const ap = airportMap.get(arr.iata)!;
      airportMap.set(arr.iata, {
        ...ap,
        properties: { ...ap.properties, count: ap.properties.count + 1 },
      });
    }

    const routeFeatures: RouteFeature[] = [];
    for (const [key, count] of routeCounts.entries()) {
      if (count < minRouteCount) continue;
      const c = routeCoords.get(key)!;
      const ids = routeFlightIds.get(key) ?? [];
      const status = routeStatus.get(key)!;
      const isScheduled = status.scheduled === status.total;
      const isHistorical = status.historical === status.total;
      const isSelected = ids.some((id) => selectedSet.has(id));

      routeFeatures.push({
        type: "Feature",
        properties: {
          routeKey: key,
          count,
          flightIds: JSON.stringify(ids),
          isScheduled,
          isHistorical,
          isSelected,
        },
        geometry: {
          type: "LineString",
          coordinates: greatCirclePoints(c.dep, c.arr),
        },
      });
    }

    return {
      routeGeoJSON: { type: "FeatureCollection" as const, features: routeFeatures },
      airportGeoJSON: { type: "FeatureCollection" as const, features: [...airportMap.values()] },
    };
  }, [flights, minRouteCount, selectedIds]);
}

const linePaint: LineLayerSpecification["paint"] = {
  "line-color": [
    "case",
    ["get", "isSelected"],
    "#f59e0b",
    ["get", "isScheduled"],
    "#64c8dc",
    ["get", "isHistorical"],
    "#969696",
    "#ef8b44",
  ],
  "line-width": [
    "case",
    ["get", "isSelected"],
    4,
    ["interpolate", ["linear"], ["get", "count"], 1, 1.5, 5, 2.5, 10, 4],
  ],
  "line-opacity": ["case", ["get", "isSelected"], 1, 0.7],
};

const lineLayout: LineLayerSpecification["layout"] = {
  "line-cap": "round",
  "line-join": "round",
};

const circlePaint: CircleLayerSpecification["paint"] = {
  "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 3, 5, 5, 20, 8],
  "circle-color": "#f59e0b",
  "circle-stroke-color": "#ffffff",
  "circle-stroke-width": 1,
  "circle-opacity": 0.85,
};

export function NativeRoutesLayer({
  flights,
  minRouteCount,
  selectedIds,
}: NativeRoutesLayerProps): JSX.Element {
  const { routeGeoJSON, airportGeoJSON } = useNativeRouteData(flights, minRouteCount, selectedIds);

  return (
    <>
      <Source id="native-routes" type="geojson" data={routeGeoJSON}>
        <Layer id={NATIVE_ROUTE_LINE_ID} type="line" paint={linePaint} layout={lineLayout} />
      </Source>
      <Source id="native-airports" type="geojson" data={airportGeoJSON}>
        <Layer id={NATIVE_AIRPORT_CIRCLE_ID} type="circle" paint={circlePaint} />
        <Layer
          id={NATIVE_AIRPORT_LABEL_ID}
          type="symbol"
          layout={{
            "text-field": ["get", "iata"],
            "text-size": 10,
            "text-offset": [0, 1.2],
            "text-anchor": "top",
          }}
          paint={{
            "text-color": "#d4d4d8",
            "text-halo-color": "#000000",
            "text-halo-width": 1,
          }}
        />
      </Source>
    </>
  );
}
