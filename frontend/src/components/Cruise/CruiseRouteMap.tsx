import { useEffect, useMemo, useRef, useState } from "react";
import MapGL, { useControl, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { createMarkerTooltip } from "../map/markerTooltip";
import type { Layer, MapViewState } from "@deck.gl/core";
import type { Cruise } from "../../types";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import { createCruiseArcsLayer, createCruiseArrowsLayer } from "../layers/cruiseArcsLayer";
import { createCruisePortsLayer } from "../layers/cruisePortsLayer";
import { DEFAULT_CRUISE_COLORS, type CruiseColorConfig } from "../../lib/cruiseColor";
import { computeBbox } from "../../utils/mapAnimationHelpers";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";

const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** The detail map shows ONE cruise — always in that cruise's own hue. */
const DETAIL_MAP_COLOR_CONFIG: CruiseColorConfig = {
  mode: "perCruise",
  colors: DEFAULT_CRUISE_COLORS,
};

const INITIAL_VIEW: MapViewState = {
  longitude: 10,
  latitude: 52,
  zoom: 3,
  pitch: 0,
  bearing: 0,
};

interface DeckOverlayProps {
  layers: Layer[];
  getTooltip: ReturnType<typeof createMarkerTooltip>;
}

function DeckGLOverlay({ layers, getTooltip }: DeckOverlayProps): null {
  const overlay = useControl<MapboxOverlay>(
    () =>
      new MapboxOverlay({
        layers,
        pickingRadius: 5,
        getTooltip,
      }),
    { position: "top-left" }
  );
  overlay.setProps({ layers, pickingRadius: 5, getTooltip });
  return null;
}

interface Props {
  cruise: Cruise;
}

/**
 * Mini-map for the cruise detail page — shows this one cruise's sea
 * route with port markers. Fetches the schematic waypoint FeatureCollection
 * from `/cruises/:id/geometry`; the shared cruiseArcsLayer splines the
 * waypoints into smooth continental-detour curves. Auto-fits bounds on
 * first geometry + port load, then lets the user pan/zoom freely.
 */
export function CruiseRouteMap({ cruise }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["map"]);
  const locale = i18n.language || "de";
  const getTooltip = useMemo(() => createMarkerTooltip(t, locale), [t, locale]);
  const mapRef = useRef<MapRef | null>(null);
  const [geometry, setGeometry] = useState<CruiseRouteFeatureCollection | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [zoom, setZoom] = useState<number>(INITIAL_VIEW.zoom ?? 3);
  const didFit = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fc = await cruiseApi.getGeometry(cruise.id);
        if (!cancelled) setGeometry(fc);
      } catch (err) {
        logger.warn("CruiseRouteMap: failed to load geometry", err);
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [cruise.id]);

  const geometryMap = useMemo(
    () => (geometry ? new Map([[cruise.id, geometry]]) : new Map()),
    [geometry, cruise.id]
  );

  const layers: Layer[] = useMemo(() => {
    // The cruise DETAIL map, not a dashboard view: it shows exactly one cruise,
    // so it always paints that cruise's own hue. It has no control panel and
    // deliberately does not follow the dashboard's cruise colour mode — a
    // per-cruise page showing the cruise's own colour needs no user setting.
    const arcsLayer = createCruiseArcsLayer([cruise], geometryMap, null, undefined, {
      zoom,
      colorConfig: DETAIL_MAP_COLOR_CONFIG,
    });
    const arrowsLayer = createCruiseArrowsLayer([cruise], geometryMap, null, {
      zoom,
      colorConfig: DETAIL_MAP_COLOR_CONFIG,
    });
    const portsLayers = createCruisePortsLayer([cruise], zoom);
    return [
      ...(arcsLayer !== null ? [arcsLayer] : []),
      ...(arrowsLayer !== null ? [arrowsLayer] : []),
      ...(portsLayers ?? []),
    ];
  }, [cruise, geometryMap, zoom]);

  const bboxPoints: Array<[number, number]> = useMemo(() => {
    const pts: Array<[number, number]> = [];
    if (cruise.departurePort) pts.push([cruise.departurePort.lon, cruise.departurePort.lat]);
    if (cruise.arrivalPort) pts.push([cruise.arrivalPort.lon, cruise.arrivalPort.lat]);
    for (const stop of cruise.stops) {
      if (stop.port) pts.push([stop.port.lon, stop.port.lat]);
    }
    if (geometry) {
      for (const feat of geometry.features) {
        for (const c of feat.geometry.coordinates) pts.push(c);
      }
    }
    return pts;
  }, [cruise.departurePort, cruise.arrivalPort, cruise.stops, geometry]);

  useEffect(() => {
    if (!mapLoaded || didFit.current) return;
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
      { padding: 40, duration: 0 }
    );
    didFit.current = true;
  }, [mapLoaded, bboxPoints]);

  return (
    <div className="relative h-64 w-full overflow-hidden rounded-md border border-border">
      <MapGL
        ref={mapRef}
        reuseMaps
        initialViewState={INITIAL_VIEW}
        mapStyle={DARK_MAP_STYLE}
        style={{ position: "absolute", inset: "0" }}
        onLoad={(): void => setMapLoaded(true)}
        onMove={(evt): void => {
          const nextZoom = Math.round(evt.viewState.zoom);
          setZoom((prev) => (prev === nextZoom ? prev : nextZoom));
        }}
      >
        {mapLoaded && <DeckGLOverlay layers={layers} getTooltip={getTooltip} />}
      </MapGL>
    </div>
  );
}
