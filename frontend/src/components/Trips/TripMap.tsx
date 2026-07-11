import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { createMarkerTooltip } from "../map/markerTooltip";
import { ArcLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer, MapViewState, PickingInfo } from "@deck.gl/core";
import type { Trip } from "../../types";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import { computeBbox } from "../../utils/mapAnimationHelpers";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";

const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const FLIGHT_RGB: [number, number, number] = [240, 169, 71];
const CRUISE_RGB: [number, number, number] = [111, 160, 214];
const STOP_DOMAIN_RGB: Record<string, [number, number, number]> = {
  poi: [94, 194, 178],
  hotel: [176, 114, 214],
  train: [143, 170, 95],
  road: [168, 153, 132],
  ferry: [74, 166, 176],
  hike: [120, 150, 106],
  bike: [159, 190, 99],
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

type Projection = "mercator" | "globe";

interface FlightArc {
  flightId: string;
  source: [number, number];
  target: [number, number];
  label: string;
}

interface CruisePath {
  cruiseId: string;
  path: [number, number][];
  label: string;
}

interface PointDatum {
  position: [number, number];
  label: string;
  color: [number, number, number];
  radiusMeters: number;
  kind: "airport" | "stop";
}

function DeckGLOverlay({
  layers,
  onClick,
  getTooltip,
}: {
  layers: Layer[];
  onClick: (info: PickingInfo) => void;
  getTooltip: ReturnType<typeof createMarkerTooltip>;
}): null {
  const overlay = useControl<MapboxOverlay>(
    () =>
      new MapboxOverlay({
        layers,
        pickingRadius: 8,
        getTooltip,
      }),
    { position: "top-left" }
  );
  overlay.setProps({ layers, pickingRadius: 8, onClick, getTooltip });
  return null;
}

interface TripMapProps {
  trip: Trip;
}

export default function TripMap({ trip }: TripMapProps): JSX.Element {
  const { t, i18n } = useTranslation(["trips", "map"]);
  const locale = i18n.language || "de";
  const getTooltip = useMemo(() => createMarkerTooltip(t, locale), [t, locale]);
  const mapRef = useRef<MapRef | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [projection, setProjection] = useState<Projection>("mercator");
  const [cruiseGeometry, setCruiseGeometry] = useState<Map<string, CruiseRouteFeatureCollection>>(
    () => new Map()
  );
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
        label: `${f.depIata ?? "?"} → ${f.arrIata ?? "?"}`,
      });
    }
    return out;
  }, [trip.flights]);

  const cruisePaths = useMemo<CruisePath[]>(() => {
    const out: CruisePath[] = [];
    const cruiseLabel = new Map<string, string>();
    for (const c of trip.cruises ?? []) {
      cruiseLabel.set(c.id, c.cruiseLine ?? "Cruise");
    }
    for (const [cruiseId, fc] of cruiseGeometry.entries()) {
      for (const feat of fc.features) {
        if (feat.geometry.coordinates.length >= 2) {
          out.push({
            cruiseId,
            path: feat.geometry.coordinates,
            label: cruiseLabel.get(cruiseId) ?? "Cruise",
          });
        }
      }
    }
    return out;
  }, [cruiseGeometry, trip.cruises]);

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
          kind: "airport",
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
          kind: "airport",
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
        kind: "stop",
      });
    }
    return out;
  }, [trip.stops]);

  /* ---- Fly-to handlers ---- */

  const flyToBbox = useCallback((points: Array<[number, number]>): void => {
    const map = mapRef.current?.getMap();
    if (!map || points.length === 0) return;
    const bbox = computeBbox(points);
    if (!bbox) return;
    const [west, south, east, north] = bbox;
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 80, duration: 1200, maxZoom: 9 }
    );
  }, []);

  const flyToPoint = useCallback((position: [number, number], zoom = 8): void => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.flyTo({
      center: position,
      zoom,
      duration: 1200,
      essential: true,
    });
  }, []);

  const handleClick = useCallback(
    (info: PickingInfo): void => {
      if (!info.object || !info.layer) return;
      const id = info.layer.id;
      if (id === "trip-flight-arcs") {
        const arc = info.object as FlightArc;
        flyToBbox([arc.source, arc.target]);
      } else if (id === "trip-cruise-paths") {
        const path = info.object as CruisePath;
        flyToBbox(path.path);
      } else if (id === "trip-airports" || id === "trip-stops") {
        const pt = info.object as PointDatum;
        flyToPoint(pt.position, pt.kind === "airport" ? 7 : 11);
      }
    },
    [flyToBbox, flyToPoint]
  );

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
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 80],
    });

    const paths = new PathLayer<CruisePath>({
      id: "trip-cruise-paths",
      data: cruisePaths,
      getPath: (d) => d.path,
      getColor: [...CRUISE_RGB, 230] as [number, number, number, number],
      getWidth: 3,
      widthMinPixels: 2,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 80],
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
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 100],
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
      autoHighlight: true,
      highlightColor: [255, 255, 255, 100],
    });

    // Stop (POI / hotel / …) labels. The markers alone were indistinguishable
    // coloured circles — the title only surfaced on hover — so a name never
    // showed on the map (#176). Render the title above each stop dot with an
    // outline so it stays readable over any basemap.
    const stopLabels = new TextLayer<PointDatum>({
      id: "trip-stop-labels",
      data: stopPoints,
      getPosition: (d) => d.position,
      getText: (d) => d.label,
      getColor: [241, 245, 249, 255],
      getSize: 12,
      sizeUnits: "pixels",
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      getPixelOffset: [0, -14],
      fontFamily: "'Inter', system-ui, sans-serif",
      fontWeight: 600,
      outlineWidth: 3,
      outlineColor: [13, 17, 23, 255],
      fontSettings: { sdf: true },
      // Stop labels are user-entered POI/hotel/port names and can contain
      // umlauts/accents (e.g. "Travemünde"). deck.gl's default
      // `characterSet` is ASCII-only (32-127) and silently drops anything
      // outside it from the font atlas (#185) — do not remove "auto".
      characterSet: "auto",
      pickable: false,
    });

    return [paths, arcs, airports, stops, stopLabels];
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

  /* ---- Globe / Mercator toggle ---- */

  const toggleProjection = useCallback((): void => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const next: Projection = projection === "globe" ? "mercator" : "globe";
    // MapLibre 5 — `setProjection` is the runtime API. Wrapped in a try
    // because some style sources may not support globe yet.
    try {
      const projApi = map as unknown as {
        setProjection?: (p: { type: string }) => void;
      };
      projApi.setProjection?.({ type: next });
      setProjection(next);
    } catch (err) {
      logger.warn("TripMap: projection toggle failed", err);
    }
  }, [projection]);

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
        cursor="grab"
        onLoad={(): void => setMapLoaded(true)}
      >
        {mapLoaded && (
          <DeckGLOverlay layers={layers} onClick={handleClick} getTooltip={getTooltip} />
        )}
      </MapGL>
      {empty && (
        <div
          className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none px-6 text-center"
          style={{ color: "var(--text-muted)", background: "rgba(13,17,23,0.5)" }}
        >
          {t("trips:detail.map.empty")}
        </div>
      )}
      <button
        type="button"
        onClick={toggleProjection}
        className="absolute top-3 right-3 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
        style={{
          background: "rgba(13,17,23,0.85)",
          backdropFilter: "blur(6px)",
          border: "1px solid var(--color-border)",
          color: projection === "globe" ? "var(--accent)" : "var(--text-muted)",
        }}
        aria-pressed={projection === "globe"}
        title={t("trips:detail.map.toggleProjectionHint")}
      >
        {projection === "globe" ? "🌐 Globe" : "🗺 Flat"}
      </button>
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
      {!empty && (
        <div
          className="absolute bottom-3 left-3 px-2.5 py-1 rounded-md text-[10px]"
          style={{
            background: "rgba(13,17,23,0.75)",
            backdropFilter: "blur(4px)",
            color: "var(--text-muted)",
          }}
        >
          {t("trips:detail.map.clickHint")}
        </div>
      )}
    </div>
  );
}
