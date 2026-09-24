import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { useControl, useMap, type MapRef } from "react-map-gl/maplibre";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { applyHoverCursor } from "../map/mapCursor";
import { createMarkerTooltip } from "../map/markerTooltip";
import { ArcLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer, MapViewState, PickingInfo } from "@deck.gl/core";
import type { TripMapContent } from "./tripMapContent";

export type { TripMapContent };
import type { Lodging } from "../../types/lodging";
import type { TourGeometry } from "../../types/tour";
import { buildLodgingPins } from "../layers/lodgingPinsLayer";
import { buildTourPaths, type TourPathDatum } from "../layers/tourPathsLayer";
import { stayNights } from "../../lib/lodgingDateDisplay";
import { declutterByDistance, pickLabelled } from "../map/labelPriority";
import { cruiseApi, type CruiseRouteFeatureCollection } from "../../lib/api/cruise";
import { computeBbox } from "../../utils/mapAnimationHelpers";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { EarthOcclusionExtension } from "../Globe/EarthOcclusionExtension";
import { GlobeLabelsOverlay } from "../Globe/GlobeLabelsOverlay";
import {
  buildTripMapGlobeLayers,
  toGlobeLabelPoints,
  toGlobeLodgingPoints,
  type TripCruisePath,
  type TripFlightArc,
  type TripPointDatum,
  type TripProjection,
} from "./TripMapGlobeLayers";
import { GLOBE_SKY, fitMaxZoom, flyToZoom } from "./tripMapProjection";
import {
  TRIP_MAP_CHROME,
  resolveTripCruiseColor,
  resolveTripFlightColor,
  resolveTripStopColor,
  useTripMapColorConfig,
} from "./tripMapColors";

const DARK_MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const INITIAL_VIEW: MapViewState = {
  longitude: 10,
  latitude: 30,
  zoom: 2,
  pitch: 0,
  bearing: 0,
};

// The datum shapes live beside the globe builder, which is the renderer with
// the stricter contract (it needs a resolved colour per line). Both
// projections read the SAME arrays — a trip must not change shape because the
// projection did.
type Projection = TripProjection;
type FlightArc = TripFlightArc;
type CruisePath = TripCruisePath;
type PointDatum = TripPointDatum;

/**
 * The deck.gl overlay, mounted the way the projection needs it.
 *
 * `interleaved` shares MapLibre's WebGL context so deck.gl uses MapLibre's
 * own projection matrices. Under the globe that is not an optimisation: an
 * overlay with its own context keeps mercator matrices, and the data detaches
 * into a flat strip floating beside the sphere. It stays OFF on the flat map,
 * where the overlay draws above the basemap and interleaving would only give
 * MapLibre's own layers a chance to paint over the trip.
 *
 * No `position`, and that part is cosmetic rather than load-bearing — this
 * comment used to claim otherwise. Measured in `@deck.gl/mapbox`:
 * `MapboxOverlay.getDefaultPosition()` returns `"top-left"`, and MapLibre's
 * `addControl` falls back to it when no position is given, so passing
 * `{ position: "top-left" }` and passing nothing are the same call. It is
 * omitted because the overlay is a render pipeline rather than a corner
 * widget and saying so is clearer, NOT because passing it broke anything.
 * The four sibling overlays still pass it, correctly.
 *
 * The caller REMOUNTS this control (a `key` on the projection) rather than
 * updating it, because the constructor — which runs inside `useControl`, i.e.
 * before any projection change lands — is where deck.gl decides which shaders
 * to compile. An overlay built in mercator never re-detects globe.
 */
function DeckGLOverlay({
  layers,
  onClick,
  getTooltip,
  interleaved,
}: {
  layers: Layer[];
  onClick: (info: PickingInfo) => void;
  getTooltip: ReturnType<typeof createMarkerTooltip>;
  interleaved: boolean;
}): null {
  const { current: map } = useMap();
  // Issue #247. See map/mapCursor.ts for why this cannot be deck.gl's
  // `getCursor`: the deck canvas has no pointer events, MapLibre owns the
  // cursor.
  const handleHover = (info: PickingInfo): void => {
    applyHoverCursor(map, Boolean(info.object));
  };
  const overlay = useControl<MapboxOverlay>(
    () =>
      new MapboxOverlay({
        layers,
        pickingRadius: 8,
        interleaved,
        getTooltip,
        onHover: handleHover,
      })
  );
  overlay.setProps({ layers, pickingRadius: 8, onClick, getTooltip, onHover: handleHover });
  return null;
}

interface TripMapProps {
  trip: TripMapContent;
  tourGeometries?: readonly {
    routeId: string;
    name: string;
    geometry: TourGeometry;
    /** A roadtrip's line takes the roadtrip hue instead of the tour one. */
    rgb?: [number, number, number];
  }[];
}

// Stable module-level default. `tourGeometries = []` inline in the props
// destructuring would allocate a NEW array reference on every render where
// the caller omits the prop (TripDetailPage.tsx renders `<TripMap trip={...} />`
// with no `tourGeometries` at all) — a fresh reference invalidates the
// `layers` useMemo below every single render, defeating the dependency array
// entirely even though it lists `tourGeometries` correctly.
const NO_TOUR_GEOMETRIES: NonNullable<TripMapProps["tourGeometries"]> = [];

export default function TripMap({
  trip,
  tourGeometries = NO_TOUR_GEOMETRIES,
}: TripMapProps): JSX.Element {
  const { t, i18n } = useTranslation(["trips", "map"]);
  const locale = i18n.language || "de";
  const getTooltip = useMemo(() => createMarkerTooltip(t, locale), [t, locale]);
  // Every hue on this map, from the same places the dashboard reads.
  const colorConfig = useTripMapColorConfig();
  const mapRef = useRef<MapRef | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [projection, setProjection] = useState<Projection>("mercator");
  /**
   * The live zoom, because labels are budgeted by it.
   *
   * The main map reveals names progressively — a world view shows a handful,
   * each zoom step roughly doubles the count (`labelBudget`), and a dense
   * cluster is thinned by screen distance on top of that. This map used to
   * hand `buildLodgingPins` a FIXED zoom and `labelsMode: "all"`, so eleven
   * hotels in one Madagascan valley printed eleven names over each other and
   * never thinned out. Same rule as everywhere else now.
   */
  const [zoom, setZoom] = useState(INITIAL_VIEW.zoom ?? 2);
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
        color: resolveTripFlightColor(f, colorConfig.flight),
      });
    }
    return out;
  }, [trip.flights, colorConfig.flight]);

  const cruisePaths = useMemo<CruisePath[]>(() => {
    const out: CruisePath[] = [];
    const cruiseLabel = new Map<string, string>();
    // Resolved per CRUISE, not per leg: "perCruise" mode gives each voyage its
    // own hue, so every leg of one cruise must land on the same one.
    const cruiseTint = new Map<string, [number, number, number]>();
    for (const c of trip.cruises ?? []) {
      cruiseLabel.set(c.id, c.cruiseLine ?? "Cruise");
      cruiseTint.set(c.id, resolveTripCruiseColor(c, colorConfig.cruise));
    }
    for (const [cruiseId, fc] of cruiseGeometry.entries()) {
      for (const feat of fc.features) {
        if (feat.geometry.coordinates.length >= 2) {
          out.push({
            cruiseId,
            path: feat.geometry.coordinates,
            label: cruiseLabel.get(cruiseId) ?? "Cruise",
            color: cruiseTint.get(cruiseId) ?? colorConfig.cruise.colors.past,
          });
        }
      }
    }
    return out;
  }, [cruiseGeometry, trip.cruises, colorConfig.cruise]);

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
          color: colorConfig.airport,
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
          color: colorConfig.airport,
          radiusMeters: 30000,
          kind: "airport",
        });
      }
    }
    return Array.from(seen.values());
  }, [trip.flights, colorConfig.airport]);

  /**
   * The trip's lodgings, one entry per HOUSE rather than per night.
   *
   * A round trip sleeps in the same hotel on its first and last night, and two
   * pins on one roof are one pin the user cannot click apart. The counts are
   * scoped to THIS trip on purpose: "2 Nächte" on a trip map means two nights
   * on this trip, not the lifetime total the lodging list shows.
   *
   * `stayCount`/`nights` are aggregates the lodging LIST endpoint computes; the
   * trip endpoint returns the plain row, so they are derived here rather than
   * read from a field the payload does not actually carry.
   */
  const lodgings = useMemo<Lodging[]>(() => {
    const byHouse = new Map<string, { lodging: Lodging; stays: number; nights: number }>();
    for (const stay of trip.lodgingStays ?? []) {
      const house = stay.lodging;
      if (!house || house.lat == null || house.lon == null) continue;
      // Via the shared resolver: an undated stay may still carry an explicit
      // night count, and a month-precision one must not have its placeholder
      // dates differenced.
      const nights = stayNights(stay);
      const seen = byHouse.get(house.id);
      if (seen) {
        seen.stays += 1;
        seen.nights += nights;
      } else {
        byHouse.set(house.id, { lodging: house, stays: 1, nights });
      }
    }
    return Array.from(byHouse.values()).map(({ lodging, stays, nights }) => ({
      ...lodging,
      stayCount: stays,
      nights,
    }));
  }, [trip.lodgingStays]);

  const stopPoints = useMemo<PointDatum[]>(() => {
    const out: PointDatum[] = [];
    for (const s of trip.stops ?? []) {
      if (s.lat == null || s.lon == null) continue;
      const rgb = resolveTripStopColor(s.domain, colorConfig.domains);
      out.push({
        position: [s.lon, s.lat],
        label: s.title,
        color: rgb,
        radiusMeters: 60000,
        kind: "stop",
      });
    }
    return out;
  }, [trip.stops, colorConfig.domains]);

  const lodgingPoints = useMemo<PointDatum[]>(
    () => toGlobeLodgingPoints(lodgings, colorConfig.lodging),
    [lodgings, colorConfig.lodging]
  );

  /* ---- Fly-to handlers ---- */

  // Every camera move is capped by the projection, not just the initial fit
  // — see `tripMapProjection.ts` for why the two caps differ.
  const flyToBbox = useCallback(
    (points: Array<[number, number]>): void => {
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
        { padding: 80, duration: 1200, maxZoom: fitMaxZoom(projection) }
      );
    },
    [projection]
  );

  const flyToPoint = useCallback(
    (position: [number, number], zoom = 8): void => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      map.flyTo({
        center: position,
        zoom: flyToZoom(projection, zoom),
        duration: 1200,
        essential: true,
      });
    },
    [projection]
  );

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
      } else if (id === "lodging-pins" || id === "lodging-pins-labels") {
        const pin = info.object as { position: [number, number] };
        flyToPoint(pin.position, 12);
      }
    },
    [flyToBbox, flyToPoint]
  );

  /* ---- deck.gl layers ---- */

  /** One shared instance, as the dashboard globe does: a stable reference
   *  keeps deck.gl from recompiling the shader pipeline every rebuild. */
  const occlusionExt = useMemo(() => new EarthOcclusionExtension(), []);
  const occlusionProps = useMemo(
    () => ({ earthOcclusionEnabled: true, earthOcclusionFadeBand: 0.04 }),
    []
  );

  const tourPathData = useMemo(() => buildTourPaths(tourGeometries), [tourGeometries]);

  const globeLayers = useMemo<Layer[]>(
    () =>
      buildTripMapGlobeLayers({
        flightArcs,
        cruisePaths,
        tourPaths: tourPathData,
        airportPoints,
        stopPoints,
        lodgingPoints,
        occlusionExt,
        occlusionProps,
      }),
    [
      flightArcs,
      cruisePaths,
      tourPathData,
      airportPoints,
      stopPoints,
      lodgingPoints,
      occlusionExt,
      occlusionProps,
    ]
  );

  const mercatorLayers = useMemo<Layer[]>(() => {
    const arcs = new ArcLayer<FlightArc>({
      id: "trip-flight-arcs",
      data: flightArcs,
      getSourcePosition: (d) => d.source,
      getTargetPosition: (d) => d.target,
      getSourceColor: (d) => [...d.color, 230] as [number, number, number, number],
      getTargetColor: (d) => [...d.color, 230] as [number, number, number, number],
      getWidth: 2,
      greatCircle: true,
      // Flat. deck.gl's ArcLayer bows every arc up out of the map by default,
      // which reads as depth on a tilted view and as a meaningless bulge on a
      // flat one — and on a short hop the bulge is taller than the route is
      // long. Height 0 lays the great circle on the ground, where the line
      // between two airports actually belongs.
      getHeight: 0,
      pickable: true,
      autoHighlight: true,
      highlightColor: TRIP_MAP_CHROME.highlight,
    });

    const paths = new PathLayer<CruisePath>({
      id: "trip-cruise-paths",
      data: cruisePaths,
      getPath: (d) => d.path,
      getColor: (d) => [...d.color, 230] as [number, number, number, number],
      getWidth: 3,
      widthMinPixels: 2,
      pickable: true,
      autoHighlight: true,
      highlightColor: TRIP_MAP_CHROME.highlight,
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
      getLineColor: TRIP_MAP_CHROME.outline,
      lineWidthMinPixels: 1,
      pickable: true,
      autoHighlight: true,
      highlightColor: TRIP_MAP_CHROME.highlightStrong,
    });

    // Tour route sections (Task 12). Coloured per LEG mode, never the
    // section's — a road tour with one ferry crossing must still show that
    // one leg as a ferry line. `isPlaceholder` legs (an unrouted `straight`
    // chord) have no dash support in deck.gl's PathLayer without an
    // extension, so a placeholder is expressed as a thinner, more
    // transparent line instead of a dash pattern — but it MUST stay clearly
    // visible, because it still carries real distance that counts towards
    // the tour's total. Measured in a browser against this dark basemap:
    // alpha 70 at 1.5px was flat-out INVISIBLE, not just "subtle" — zero
    // pixels drawn between two assigned stops at any zoom. Do not lower
    // these again in the name of contrast; 170/2px is the floor that stays
    // visible while still reading as weaker than a drawn route at 255/3.5px.
    const tourPaths = new PathLayer<TourPathDatum>({
      id: "trip-tour-paths",
      data: tourPathData,
      getPath: (d) => d.path,
      getColor: (d) =>
        [...d.color, d.isPlaceholder ? 170 : 255] as [number, number, number, number],
      getWidth: (d) => (d.isPlaceholder ? 2 : 3.5),
      widthUnits: "pixels",
      widthMinPixels: 2,
      pickable: true,
      autoHighlight: true,
      highlightColor: TRIP_MAP_CHROME.highlight,
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
      getLineColor: TRIP_MAP_CHROME.outline,
      lineWidthMinPixels: 1.5,
      pickable: true,
      autoHighlight: true,
      highlightColor: TRIP_MAP_CHROME.highlightStrong,
    });

    // Stop (POI / hotel / …) labels. The markers alone were indistinguishable
    // coloured circles — the title only surfaced on hover — so a name never
    // showed on the map (#176). Render the title above each stop dot with an
    // outline so it stays readable over any basemap.
    // Stops follow the same budget. They carry no visit count to rank by, so
    // the weight is a constant — `pickLabelled` then keeps the first N, and
    // `declutterByDistance` does the work that matters here: stops on one trip
    // sit close together far more often than airports do.
    const stopLabelData = declutterByDistance(
      pickLabelled(stopPoints, () => 1, "important", zoom),
      () => 1,
      (d) => d.position,
      zoom
    );

    const stopLabels = new TextLayer<PointDatum>({
      id: "trip-stop-labels",
      data: stopLabelData,
      getPosition: (d) => d.position,
      getText: (d) => d.label,
      getColor: TRIP_MAP_CHROME.labelText,
      getSize: 12,
      sizeUnits: "pixels",
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      getPixelOffset: [0, -14],
      fontFamily: "'Inter', system-ui, sans-serif",
      fontWeight: 600,
      outlineWidth: 3,
      outlineColor: TRIP_MAP_CHROME.outline,
      fontSettings: { sdf: true },
      // Stop labels are user-entered POI/hotel/port names and can contain
      // umlauts/accents (e.g. "Travemünde"). deck.gl's default
      // `characterSet` is ASCII-only (32-127) and silently drops anything
      // outside it from the font atlas (#185) — do not remove "auto".
      characterSet: "auto",
      pickable: false,
    });

    // The trip's hotels. Reuses the layer the main map already draws them with
    // (same rose, same dot weight, same tooltip — `markerTooltip` already
    // knows the "lodging-pins" ids), so a house looks the same wherever it is
    // shown. Labels are forced on: a trip has a handful of hotels, not the
    // hundreds the flat map's priority budget exists for.
    const lodgingPins =
      buildLodgingPins(lodgings, 1, zoom, {
        labelsMode: "important",
        // Without this the pins fall back to the DEFAULT lodging config, so a
        // user who switched hotels to "by rating" saw it everywhere but here.
        colors: colorConfig.lodging,
      }) ?? [];

    return [paths, arcs, airports, tourPaths, stops, ...lodgingPins, stopLabels];
  }, [
    flightArcs,
    cruisePaths,
    airportPoints,
    stopPoints,
    lodgings,
    zoom,
    tourPathData,
    colorConfig.lodging,
  ]);

  const layers = projection === "globe" ? globeLayers : mercatorLayers;

  /** Every name on the globe, in the shape the HTML overlay reads. A deck.gl
   *  TextLayer draws nothing under globe projection, which is why the trip's
   *  stop names vanished on every toggle. */
  const globeLabelPoints = useMemo(
    () => toGlobeLabelPoints([...stopPoints, ...lodgingPoints]),
    [stopPoints, lodgingPoints]
  );
  const globeAirportLabels = useMemo(() => toGlobeLabelPoints(airportPoints), [airportPoints]);

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
    // Hotels count towards the fit too. A round trip whose flights all land in
    // one capital would otherwise open zoomed on the airport while the twelve
    // houses it actually visited sit outside the frame.
    for (const l of lodgings) {
      if (l.lat != null && l.lon != null) pts.push([l.lon, l.lat]);
    }
    return pts;
  }, [flightArcs, cruisePaths, stopPoints, lodgings]);

  /**
   * Frame the whole trip, at a zoom the current projection can honour.
   *
   * The cap is the only thing that differs, and it matters: a two-airport trip
   * fits at zoom 9 on the flat map and reads fine, while the same 9 on a
   * sphere puts the camera close enough that the horizon leaves the frame and
   * the globe stops looking like one. Called on load and again on every
   * projection switch, which is what "the globe fills the frame" means here.
   */
  const fitTrip = useCallback(
    (forProjection: Projection, durationMs: number): void => {
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
        {
          padding: 60,
          duration: durationMs,
          maxZoom: fitMaxZoom(forProjection),
        }
      );
    },
    [bboxPoints]
  );

  useEffect(() => {
    if (!mapLoaded || didFit.current) return;
    if (bboxPoints.length === 0) return;
    fitTrip(projection, 0);
    didFit.current = true;
    // `projection` is read, not depended on: this runs once, on load, when it
    // is still "mercator". The switch does its own fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, bboxPoints, fitTrip]);

  /* ---- Globe / Mercator toggle ---- */

  const toggleProjection = useCallback((): void => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const next: Projection = projection === "globe" ? "mercator" : "globe";
    // MapLibre 5 — `setProjection` and `setSky` are the runtime APIs. Both are
    // wrapped because a style source may not support globe, and because the
    // toggle must not take the map down with it if one of them throws.
    //
    // ORDER IS THE POINT. `setProjection` runs here, imperatively, BEFORE the
    // re-render that remounts the deck.gl overlay — and the overlay's
    // constructor is where deck.gl reads the projection. Flip the two and the
    // overlay caches mercator and never re-detects globe: the basemap becomes
    // a sphere while the trip stays a flat strip pasted over it.
    const projApi = map as unknown as {
      setProjection?: (p: { type: string }) => void;
      setSky?: (sky?: unknown) => void;
    };
    try {
      projApi.setProjection?.({ type: next });
    } catch (err) {
      // The projection itself did not take, so nothing below should pretend
      // it did: leave React on the projection MapLibre is still showing.
      logger.warn("TripMap: projection toggle failed", err);
      return;
    }
    try {
      // A globe without a sky has a hard black edge where the horizon should
      // be; a flat map has no horizon at all, so the sky comes off again.
      projApi.setSky?.(next === "globe" ? GLOBE_SKY : undefined);
    } catch (err) {
      // Its OWN try, and deliberately non-fatal. A style source may not
      // support a sky, and a missing horizon is cosmetic — but while this
      // shared one try with the line below, a throw left MapLibre on the
      // globe and React on mercator, so the overlay stayed non-interleaved
      // and the data detached into a flat strip. That is the very bug this
      // toggle was fixed for, re-entered through the error path.
      logger.warn("TripMap: setSky failed", err);
    }
    setProjection(next);
    fitTrip(next, 600);
  }, [projection, fitTrip]);

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
        onLoad={(e): void => {
          setMapLoaded(true);
          setZoom(e.target.getZoom());
        }}
        // moveend statt zoom: es feuert auch nach fitBounds und nach einem
        // flyTo, also genau dann, wenn sich das Label-Budget wirklich
        // geaendert hat — und nicht bei jedem Zwischenbild.
        onMoveEnd={(e): void => setZoom(e.viewState.zoom)}
      >
        {mapLoaded && (
          // `key` on the projection: the overlay is REMOUNTED rather than
          // updated, because deck.gl reads the projection in MapboxOverlay's
          // constructor and nowhere else.
          <DeckGLOverlay
            key={projection}
            layers={layers}
            onClick={handleClick}
            getTooltip={getTooltip}
            interleaved={projection === "globe"}
          />
        )}
      </MapGL>
      {/* Names on the globe. deck.gl 9's billboard TextLayer renders nothing
          under globe projection, so the flat map's `trip-stop-labels` and the
          lodging pins' own labels are simply absent there — this HTML overlay
          is how the dashboard globe solved the same problem, and it brings the
          horizon cull with it. */}
      {projection === "globe" && (
        <GlobeLabelsOverlay
          mapRef={mapRef}
          mapReady={mapLoaded}
          airports={globeAirportLabels}
          ports={globeLabelPoints}
          mode="important"
        />
      )}
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
        {flightArcs.length}✈ · {cruisePaths.length}⚓ · {lodgings.length}🏨 · {stopPoints.length}📍
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
