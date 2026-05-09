import { useEffect, useMemo, useRef, useState } from "react";
import MapGL, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ArcLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer, MapViewState } from "@deck.gl/core";
import type { Trip } from "../../types";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import { computeBbox } from "../../utils/mapAnimationHelpers";
import { logger } from "../../lib/logger";

const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const FLIGHT_RGB: [number, number, number] = [240, 169, 71]; // amber #f0a947
const CRUISE_RGB: [number, number, number] = [111, 160, 214]; // cyan-blue #6fa0d6
const STOP_DOMAIN_RGB: Record<string, [number, number, number]> = {
  poi: [94, 194, 178],     // teal-green
  hotel: [176, 114, 214],  // purple
  train: [143, 170, 95],   // olive
  road: [168, 153, 132],   // tan
  ferry: [74, 166, 176],   // teal-blue
  hike: [120, 150, 106],   // sage
  bike: [159, 190, 99],    // lime
  other: [180, 180, 180],
};
const AIRPORT_RGB: [number, number, number] = [240, 169, 71];

const INITIAL_VIEW: MapViewState = {
  longitude: 10,
  latitude: 30,
  zoom: 2,
  pitch: 0,
  bearing: 0,
};

interface FlightArc {
  flightId: string;
  source: [number, number];
  target: [number, number];
}

interface CruisePath {
  cruiseId: string;
  path: [number, number][];
}

interface PointDatum {
  position: [number, number];
  label: string;
  color: [number, number, number];
  radiusMeters: number;
}

function DeckGLOverlay({ layers }: { layers: Layer[] }): null {
  const overlay = useControl<MapboxOverlay>(
    () => new MapboxOverlay({ layers, pickingRadius: 6 }),
    { position: "top-left" }
  );
  overlay.setProps({ layers, pickingRadius: 6 });
  return null;
}

interface TripMapProps {
  trip: Trip;
}

/**
 * Per-trip map (Phase-1 iteration 4). Renders this trip's flights
 * (great-circle arcs), cruises (Hybrid v2 schematic-routed paths via
 * `/cruises/geometry/batch`), and user-placed stops on a Carto dark
 * basemap. Bbox-fits to the union of all data points once on first
 * load, then lets the user pan / zoom freely.
 *
 * Empty-data trips render the basemap with the world centred — no
 * crash on a brand-new trip without any linked items yet.
 */
export default function TripMap({ trip }: TripMapProps): JSX.Element {
  const mapRef = useRef<MapRef | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [cruiseGeometry, setCruiseGeometry] = useState<
    Map<string, CruiseRouteFeatureCollection>
  >(() => new Map());
  const didFit = useRef(false);

  const cruiseIds = useMemo(() => (trip.cruises ?? []).map((c) => c.id), [trip.cruises]);

  useEffect(() => {
    if (cruiseIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const batch = await cruiseApi.getGeometryBatch(cruiseIds);
        if (!cancelled) setCruiseGeometry(batch);
      } catch (err) {
        logger.warn("TripMap: cruise geometry fetch failed", err);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [cruiseIds]);

  /* ---- Build deck.gl data ---- */

  const flightArcs = useMemo<FlightArc[]>(() => {
    const out: FlightArc[] = [];
    for (const f of trip.flights ?? []) {
      if (
        f.depLat == null ||
        f.depLon == null ||
        f.arrLat == null ||
        f.arrLon == null ||
        (f.depLat === 0 && f.depLon === 0) ||
        (f.arrLat === 0 && f.arrLon === 0)
      ) {
        continue;
      }
      out.push({
        flightId: f.id,
        source: [f.depLon, f.depLat],
        target: [f.arrLon, f.arrLat],
      });
    }
    return out;
  }, [trip.flights]);

  const cruisePaths = useMemo<CruisePath[]>(() => {
    const out: CruisePath[] = [];
    for (const [cruiseId, fc] of cruiseGeometry.entries()) {
      for (const feat of fc.features) {
        if (feat.geometry.coordinates.length >= 2) {
          out.push({ cruiseId, path: feat.geometry.coordinates });
        }
      }
    }
    return out;
  }, [cruiseGeometry]);

  const airportPoints = useMemo<PointDatum[]>(() => {
    const seen = new Map<string, PointDatum>();
    for (const f of trip.flights ?? []) {
      const dep = f.depIata ?? `${f.depLat},${f.depLon}`;
      const arr = f.arrIata ?? `${f.arrLat},${f.arrLon}`;
      if (
        f.depLat != null &&
        f.depLon != null &&
        !(f.depLat === 0 && f.depLon === 0) &&
        !seen.has(dep)
      ) {
        seen.set(dep, {
          position: [f.depLon, f.depLat],
          label: f.depIata ?? "",
          color: AIRPORT_RGB,
          radiusMeters: 30000,
        });
      }
      if (
        f.arrLat != null &&
        f.arrLon != null &&
        !(f.arrLat === 0 && f.arrLon === 0) &&
        !seen.has(arr)
      ) {
        seen.set(arr, {
          position: [f.arrLon, f.arrLat],
          label: f.arrIata ?? "",
          color: AIRPORT_RGB,
          radiusMeters: 30000,
        });
      }
    }
    return Array.from(seen.values());
  }, [trip.flights]);

  const stopPoints = useMemo<PointDatum[]>(() => {
    const out: PointDatum[] = [];
    for (const s of trip.stops ?? []) {
      if (s.lat == null || s.lon == null) continue;
      const rgb = STOP_DOMAIN_RGB[s.domain ?? "other"] ?? STOP_DOMAIN_RGB.other;
      out.push({
        position: [s.lon, s.lat],
        label: s.title,
        color: rgb,
        radiusMeters: 60000,
      });
    }
    return out;
  }, [trip.stops]);

  /* ---- deck.gl layers ---- */

  const layers = useMemo<Layer[]>(() => {
    const arcs = new ArcLayer<FlightArc>({
      id: "trip-flight-arcs",
      data: flightArcs,
      getSourcePosition: (d) => d.source,
      getTargetPosition: (d) => d.target,
      getSourceColor: [...FLIGHT_RGB, 230] as [number, number, number, number],
      getTargetColor: [...FLIGHT_RGB, 230] as [number, number, number, number],
      getWidth: 2,
      greatCircle: true,
      pickable: false,
    });

    const paths = new PathLayer<CruisePath>({
      id: "trip-cruise-paths",
      data: cruisePaths,
      getPath: (d) => d.path,
      getColor: [...CRUISE_RGB, 230] as [number, number, number, number],
      getWidth: 3,
      widthMinPixels: 2,
      pickable: false,
    });

    const airports = new ScatterplotLayer<PointDatum>({
      id: "trip-airports",
      data: airportPoints,
      getPosition: (d) => d.position,
      getFillColor: (d) => [...d.color, 230] as [number, number, number, number],
      getRadius: (d) => d.radiusMeters,
      radiusMinPixels: 4,
      radiusMaxPixels: 8,
      stroked: true,
      getLineColor: [13, 17, 23, 255],
      lineWidthMinPixels: 1,
      pickable: false,
    });

    const stops = new ScatterplotLayer<PointDatum>({
      id: "trip-stops",
      data: stopPoints,
      getPosition: (d) => d.position,
      getFillColor: (d) => [...d.color, 230] as [number, number, number, number],
      getRadius: (d) => d.radiusMeters,
      radiusMinPixels: 6,
      radiusMaxPixels: 12,
      stroked: true,
      getLineColor: [13, 17, 23, 255],
      lineWidthMinPixels: 1.5,
      pickable: true,
    });

    return [paths, arcs, airports, stops];
  }, [flightArcs, cruisePaths, airportPoints, stopPoints]);

  /* ---- bbox fit ---- */

  const bboxPoints = useMemo<Array<[number, number]>>(() => {
    const pts: Array<[number, number]> = [];
    for (const a of flightArcs) {
      pts.push(a.source, a.target);
    }
    for (const p of cruisePaths) {
      for (const c of p.path) pts.push(c);
    }
    for (const s of stopPoints) {
      pts.push(s.position);
    }
    return pts;
  }, [flightArcs, cruisePaths, stopPoints]);

  useEffect(() => {
    if (!mapLoaded || didFit.current) return;
    if (bboxPoints.length === 0) return;
    const bbox = computeBbox(bboxPoints);
    if (!bbox) return;
    const [west, south, east, north] = bbox;
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 60, duration: 0, maxZoom: 9 }
    );
    didFit.current = true;
  }, [mapLoaded, bboxPoints]);

  const empty = bboxPoints.length === 0;

  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{
        height: 540,
        border: "1px solid var(--color-border)",
      }}
    >
      <MapGL
        ref={mapRef}
        reuseMaps
        initialViewState={INITIAL_VIEW}
        mapStyle={DARK_MAP_STYLE}
        style={{ position: "absolute", inset: 0 }}
        onLoad={(): void => setMapLoaded(true)}
      >
        {mapLoaded && <DeckGLOverlay layers={layers} />}
      </MapGL>
      {empty && (
        <div
          className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none"
          style={{ color: "var(--text-muted)", background: "rgba(13,17,23,0.5)" }}
        >
          Diese Reise hat noch keine Geo-Daten — füge Stopps mit Koordinaten oder
          Flüge / Kreuzfahrten mit Routendaten hinzu.
        </div>
      )}
      <div
        className="absolute bottom-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-mono"
        style={{
          background: "rgba(13,17,23,0.75)",
          backdropFilter: "blur(4px)",
          color: "var(--text-muted)",
        }}
      >
        {flightArcs.length}✈ · {cruisePaths.length}⚓ · {stopPoints.length}📍
      </div>
    </div>
  );
}
