import { STYLE_OPTIONS } from "../Globe/globeStyles";
import { SharedMapOverlays } from "../map/SharedMapOverlays";
import { useBasemapStyle } from "../map/useBasemapStyle";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { type MapRef } from "react-map-gl/maplibre";
import { DeckGLOverlay } from "../map/DeckGLOverlay";
import { createMarkerTooltip } from "../map/markerTooltip";
import type { Layer, MapViewState, PickingInfo } from "@deck.gl/core";
import type { TripMapContent } from "./tripMapContent";

export type { TripMapContent };
import type { TourGeometry } from "../../types/tour";
import { buildTourPaths } from "../layers/tourPathsLayer";
import { computeBbox } from "../../utils/mapAnimationHelpers";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { EarthOcclusionExtension } from "../Globe/EarthOcclusionExtension";
import { GlobeLabelsOverlay } from "../Globe/GlobeLabelsOverlay";
import {
  buildTripMapGlobeLayers,
  toGlobeLabelPoints,
  type TripCruisePath,
  type TripFlightArc,
  type TripPointDatum,
  type TripMapGlobeStack,
  type TripProjection,
} from "./TripMapGlobeLayers";
import { useTripMapNative } from "./useTripMapNative";
import { HoverTooltip } from "../map/cards/HoverTooltip";
import { GLOBE_SKY, fitMaxZoom, flyToZoom } from "./tripMapProjection";
import { useTripLayers } from "./tripMapExtraLayers";
import { useTripMapColorConfig } from "./tripMapColors";
import { tripBoundsPoints, type LngLat } from "./tripMapBounds";
import { journeyFromTripFlight } from "../map/cards/journeys/journeyNormalize";
import type { MapJourney } from "../map/cards/journeys/journeyTypes";
import { decorateTripMapLayers } from "./tripMapCards";
import { TripMapCardHost } from "./TripMapCardHost";
import { stationLabelPoints } from "../Globe/globePinLabels";
import { useTripCruiseGeometry } from "./useTripCruiseGeometry";
import {
  buildTripMapData,
  dayFocusPoints,
  emptyTripMapData,
  withoutHiddenGroups,
  type TripMapPlace,
} from "./tripMapData";
import { buildMercatorTripLayers } from "./tripMapMercatorLayers";
import type { DirectionLine } from "./tripMapArrows";
import { groupsPresentIn, withoutHidden, type LayerGroup } from "./tripMapGroups";
import { TripMapLegend } from "./TripMapLegend";
import { TripMapInfoCard } from "./TripMapInfoCard";
import { cruiseInfo, lodgingInfo, stopInfo } from "./tripMapInfo";
import { useTripMapInfoStore } from "../../store/tripMapInfoStore";
import { useMapCardSelectionStore } from "../../store/mapCardSelectionStore";
import { MapLoadFailedNotice } from "../map/MapLoadFailedNotice";
import { reuseMapsEnabled } from "../../lib/mapReuse";

export type { TripMapPlace };

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

interface TripMapProps {
  trip: TripMapContent;
  tourGeometries?: readonly {
    routeId: string;
    name: string;
    geometry: TourGeometry;
    /** A roadtrip's line takes the roadtrip hue instead of the tour one. */
    rgb?: [number, number, number];
  }[];
  /** Drawn over everything else — the roadtrip page's selected station. */
  extraLayers?: readonly Layer[];
  /**
   * The points `extraLayers` cover, so the camera frames them and a trip whose
   * only geo data is in those layers is not reported as empty.
   */
  extraPoints?: readonly LngLat[];
  /** Told each projection switch, so the caller builds its layers' globe variant. */
  onProjectionChange?: (projection: TripProjection) => void;
  /**
   * Told where the map was clicked — set only while the caller waits for a
   * point (the roadtrip editor's "add a station from the map"). The cursor
   * says so; without it a click does nothing, as before.
   */
  onMapClick?: (point: { lat: number; lon: number }) => void;
  /** The trip's id, for the info card's link into its timeline; absent off a trip page. */
  tripId?: string;
  /** `YYYY-MM-DD` on the trip's clock: that day is drawn, the rest faint. Null is every day. */
  day?: string | null;
  /** The places the trip visited, so they get names and numbers (`tripMapData.ts`). */
  places?: readonly TripMapPlace[];
  /** Lines of the caller's layers (rail, ferry, bus) that should carry a direction arrow. */
  extraDirectionLines?: readonly DirectionLine[];
  /** The caller's own entries on the chosen day (rail, ferry, bus, rental), so framing the day includes them. */
  dayPoints?: readonly LngLat[];
}

// Stable module-level default. `tourGeometries = []` inline in the props
// destructuring would allocate a NEW array reference on every render where
// the caller omits the prop (any caller rendering `<TripMap trip={...} />`
// with no `tourGeometries` at all) — a fresh reference invalidates the
// `layers` useMemo below every single render, defeating the dependency array
// entirely even though it lists `tourGeometries` correctly.
const NO_TOUR_GEOMETRIES: NonNullable<TripMapProps["tourGeometries"]> = [];
const NO_EXTRA_POINTS: readonly LngLat[] = [];
const NO_PLACES: readonly TripMapPlace[] = [];
const NO_LINES: readonly DirectionLine[] = [];
/** The trip map is fingertip-sized: a wider pick than the 5 px every other map uses. */
const TRIP_PICKING_RADIUS = 8;

export default function TripMap({
  trip,
  tourGeometries = NO_TOUR_GEOMETRIES,
  extraLayers,
  extraPoints = NO_EXTRA_POINTS,
  onProjectionChange,
  onMapClick,
  tripId,
  day = null,
  places = NO_PLACES,
  extraDirectionLines = NO_LINES,
  dayPoints = NO_EXTRA_POINTS,
}: TripMapProps): JSX.Element {
  const mapStyle = useBasemapStyle();
  const globeSky = STYLE_OPTIONS.find((option) => option.url === mapStyle)?.sky ?? GLOBE_SKY;
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
  const didFit = useRef(false);

  const cruiseIds = useMemo(() => (trip.cruises ?? []).map((c) => c.id), [trip.cruises]);

  const {
    geometry: cruiseGeometry,
    failed: cruiseGeometryFailed,
    retry: retryCruiseGeometry,
  } = useTripCruiseGeometry(cruiseIds);

  /**
   * Everything drawn, derived once (`tripMapData.ts`). A throw here must not
   * blank the page: the map stays up empty, says so, and the cause is logged.
   */
  const built = useMemo(() => {
    try {
      return {
        data: buildTripMapData(trip, colorConfig, cruiseGeometry, day, places),
        failed: false,
      };
    } catch (err) {
      logger.warn("TripMap: building the map data failed", err);
      return { data: emptyTripMapData(), failed: true };
    }
  }, [trip, colorConfig, cruiseGeometry, day, places]);

  /** Groups the reader switched off in the legend. */
  const [hidden, setHidden] = useState<ReadonlySet<LayerGroup>>(() => new Set());
  const toggleGroup = useCallback((group: LayerGroup): void => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);
  const data = useMemo(() => withoutHiddenGroups(built.data, hidden), [built.data, hidden]);
  const { flightArcs, cruisePaths, airportPoints, lodgings, lodgingPoints, stopPoints } = data;
  const shownExtraLayers = useMemo(
    () => (extraLayers ? withoutHidden(extraLayers, hidden) : undefined),
    [extraLayers, hidden]
  );
  const directionLines = useMemo(
    () => [...data.directionLines, ...extraDirectionLines.filter((l) => !hidden.has(l.group))],
    [data.directionLines, extraDirectionLines, hidden]
  );
  const dimLodgingIds = useMemo(
    () =>
      new Set(
        [...built.data.lodgingMeta].filter(([, meta]) => meta.dim).map(([lodgingId]) => lodgingId)
      ),
    [built.data.lodgingMeta]
  );
  const { present, legendColors } = useMemo(() => {
    const d = built.data;
    const groups = groupsPresentIn(extraLayers ?? []);
    if (d.flightArcs.length > 0 || d.airportPoints.length > 0) groups.add("flights");
    if (d.cruisePaths.length > 0) groups.add("cruise");
    if (d.lodgings.length > 0) groups.add("lodging");
    if (d.stopPoints.length > 0) groups.add("stops");
    if (tourGeometries.length > 0) groups.add("tours");
    if (places.length > 0) groups.add("places");
    const colors: Partial<Record<LayerGroup, [number, number, number]>> = {
      flights: d.flightArcs[0]?.color,
      cruise: d.cruisePaths[0]?.color,
      lodging: d.lodgingPoints[0]?.color,
      stops: d.stopPoints[0]?.color,
    };
    return { present: groups, legendColors: colors };
  }, [built.data, extraLayers, tourGeometries, places]);

  /** One click, one persistent card. The dashboard's anchored cards stay for flights and airports. */
  const openInfo = useTripMapInfoStore((s) => s.open);
  const closeInfo = useTripMapInfoStore((s) => s.close);
  useEffect(() => closeInfo, [closeInfo]);
  const seqOf = useCallback((key: string) => built.data.seqByKey.get(key), [built.data.seqByKey]);

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
      const meta = built.data;
      if (id === "trip-flight-arcs") {
        closeInfo();
        const arc = info.object as FlightArc;
        flyToBbox([arc.source, arc.target]);
      } else if (id === "trip-cruise-paths") {
        const path = info.object as CruisePath;
        useMapCardSelectionStore.getState().clear();
        openInfo(
          cruiseInfo({
            id: path.cruiseId,
            title: path.label,
            span: meta.cruiseSpans.get(path.cruiseId) ?? null,
            tripId,
          })
        );
        flyToBbox(path.path);
      } else if (id === "trip-airports") {
        closeInfo();
        flyToPoint((info.object as PointDatum).position, 7);
      } else if (id === "trip-stops") {
        const pt = info.object as PointDatum;
        useMapCardSelectionStore.getState().clear();
        if (pt.entityId) {
          openInfo(
            stopInfo({
              key: pt.entityId,
              title: pt.label,
              span: meta.stopMeta.get(pt.entityId)?.span ?? null,
              tripId,
            })
          );
        }
        flyToPoint(pt.position, 11);
      } else if (id.startsWith("lodging-pins")) {
        const pin = info.object as {
          position: [number, number];
          lodgingId?: string;
          entityId?: string;
        };
        const lodgingId = pin.lodgingId ?? pin.entityId;
        const house = lodgings.find((l) => l.id === lodgingId);
        const stay = lodgingId ? meta.lodgingMeta.get(lodgingId) : undefined;
        if (house && stay) {
          useMapCardSelectionStore.getState().clear();
          openInfo(
            lodgingInfo({
              id: house.id,
              name: house.name,
              city: house.city ?? null,
              span: stay.span,
              stayId: stay.stayId,
              tripId,
            })
          );
        }
        flyToPoint(pin.position, 12);
      }
    },
    [built.data, lodgings, tripId, openInfo, closeInfo, flyToBbox, flyToPoint]
  );

  /* ---- deck.gl layers ---- */

  /** One shared instance, as the dashboard globe does: a stable reference
   *  keeps deck.gl from recompiling the shader pipeline every rebuild. */
  const occlusionExt = useMemo(() => new EarthOcclusionExtension(), []);
  const occlusionProps = useMemo(
    () => ({ earthOcclusionEnabled: true, earthOcclusionFadeBand: 0.04 }),
    []
  );

  const allTourPaths = useMemo(() => buildTourPaths(tourGeometries), [tourGeometries]);
  const tourPathData = useMemo(
    () => (hidden.has("tours") ? [] : allTourPaths),
    [allTourPaths, hidden]
  );

  const globeStack = useMemo<TripMapGlobeStack>(
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

  const mercator = useMemo<{ layers: Layer[]; failed: boolean }>(() => {
    try {
      return {
        failed: false,
        layers: buildMercatorTripLayers({
          flightArcs,
          cruisePaths,
          tourPathData,
          airportPoints,
          stopPoints,
          lodgings,
          dimLodgingIds,
          lodgingColors: colorConfig.lodging,
          labelItems: data.labelItems,
          directionLines,
          zoom,
        }),
      };
    } catch (err) {
      // The map keeps its basemap and the caller's layers; the notice says
      // what is missing instead of an empty map passing for an empty trip.
      logger.warn("TripMap: building the flat map layers failed", err);
      return { layers: [], failed: true };
    }
  }, [
    flightArcs,
    cruisePaths,
    airportPoints,
    stopPoints,
    lodgings,
    dimLodgingIds,
    tourPathData,
    colorConfig.lodging,
    data.labelItems,
    directionLines,
    zoom,
  ]);

  const mercatorLayers = mercator.layers;

  // Flights as journeys, so an arc and an airport open the shared card (forgejo#323).
  const flightJourneys = useMemo(
    () =>
      (trip.flights ?? []).map(journeyFromTripFlight).filter((j): j is MapJourney => j !== null),
    [trip.flights]
  );
  const baseLayers = useMemo(
    () =>
      decorateTripMapLayers(
        projection === "globe" ? globeStack.deck : mercatorLayers,
        flightJourneys
      ),
    [projection, globeStack, mercatorLayers, flightJourneys]
  );
  // The ground data on the globe is native MapLibre layers (forgejo#331).
  const nativeLayers = useMemo(
    () => (projection === "globe" ? decorateTripMapLayers(globeStack.native, flightJourneys) : []),
    [projection, globeStack, flightJourneys]
  );
  const { isOverNative, tooltipRef } = useTripMapNative({
    mapRef,
    mapReady: mapLoaded,
    layers: nativeLayers,
    markerTooltip: getTooltip,
    onClick: handleClick,
  });
  // Station labels, and the caller's layers occluded on the globe (tripMapExtraLayers.ts).
  const layers = useTripLayers(
    baseLayers,
    shownExtraLayers,
    projection,
    occlusionExt,
    occlusionProps
  );
  const globeStationLabels = useMemo(
    () => stationLabelPoints(shownExtraLayers ?? []),
    [shownExtraLayers]
  );

  /** Every name on the globe, in the shape the HTML overlay reads. A deck.gl
   *  TextLayer draws nothing under globe projection, which is why the trip's
   *  stop names vanished on every toggle. */
  // Places have no dot of ours to hang a label on, only the caller's pins, so
  // their globe names are built from the same items the flat map labels.
  const globePlaceLabels = useMemo<TripPointDatum[]>(
    () =>
      data.labelItems
        .filter((i) => i.kind === "place")
        .map((i) => ({
          position: i.position,
          label: i.text,
          color: colorConfig.airport,
          radiusMeters: 0,
          kind: "stop" as const,
          seq: i.seq,
        })),
    [data.labelItems, colorConfig.airport]
  );
  const globeLabelPoints = useMemo(
    () => toGlobeLabelPoints([...stopPoints, ...lodgingPoints, ...globePlaceLabels]),
    [stopPoints, lodgingPoints, globePlaceLabels]
  );
  const globeAirportLabels = useMemo(() => toGlobeLabelPoints(airportPoints), [airportPoints]);

  /* ---- bbox fit ---- */

  const bboxPoints = useMemo<LngLat[]>(
    () =>
      tripBoundsPoints({
        flightArcs: built.data.flightArcs,
        cruisePaths: built.data.cruisePaths,
        stopPoints: built.data.stopPoints,
        lodgings: built.data.lodgings,
        tourPaths: allTourPaths,
        extraPoints,
      }),
    [built.data, allTourPaths, extraPoints]
  );

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `projection` is read, not depended on: runs once on load, while still "mercator"; the switch does its own fit
  }, [mapLoaded, bboxPoints, fitTrip]);

  // Choosing a day frames that day's entries, "all days" frames the trip again.
  // Only on a CHANGE of day: the first fit above already framed the trip.
  const lastDay = useRef(day);
  useEffect(() => {
    if (lastDay.current === day) return;
    lastDay.current = day;
    if (!mapLoaded) return;
    const focus = dayFocusPoints(built.data, places, day, dayPoints);
    if (focus.length === 0) fitTrip(projection, 800);
    else flyToBbox(focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on a day change only; the data it reads is the day's own
  }, [day, mapLoaded]);

  // A new basemap resets MapLibre's projection and sky. Restore both before
  // the next frame so travel layers keep sharing the globe's coordinates.
  useEffect(() => {
    if (!mapLoaded) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const restoreProjection = (): void => {
      try {
        map.setProjection({ type: projection });
      } catch (err) {
        logger.warn("TripMap: restoring projection failed", err);
      }
      try {
        if (projection === "globe") map.setSky(globeSky);
      } catch (err) {
        logger.warn("TripMap: restoring sky failed", err);
      }
    };
    map.on("style.load", restoreProjection);
    // Inline raster styles can finish before this effect installs its listener.
    if (map.getStyle()) restoreProjection();
    return () => {
      map.off("style.load", restoreProjection);
    };
  }, [mapLoaded, projection, globeSky]);

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
      projApi.setSky?.(next === "globe" ? globeSky : undefined);
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
    onProjectionChange?.(next);
    fitTrip(next, 600);
  }, [projection, fitTrip, globeSky, onProjectionChange]);

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
        reuseMaps={reuseMapsEnabled()}
        initialViewState={INITIAL_VIEW}
        mapStyle={mapStyle}
        style={{ position: "absolute", inset: 0 }}
        cursor={onMapClick ? "crosshair" : "grab"}
        onClick={
          onMapClick ? (e): void => onMapClick({ lat: e.lngLat.lat, lon: e.lngLat.lng }) : undefined
        }
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
            isOverNative={isOverNative}
            interleaved={projection === "globe"}
            pickingRadius={TRIP_PICKING_RADIUS}
            handleCursor
          />
        )}
        <SharedMapOverlays />
      </MapGL>
      <HoverTooltip ref={tooltipRef} />
      <TripMapCardHost mapRef={mapRef} mapLoaded={mapLoaded} />
      <TripMapLegend
        present={present}
        hidden={hidden}
        onToggle={toggleGroup}
        colors={legendColors}
      />
      <TripMapInfoCard seqOf={seqOf} />
      {(built.failed || mercator.failed) && (
        <p
          role="alert"
          data-testid="trip-map-build-error"
          className="absolute top-14 left-3 right-3 z-20 rounded-md px-3 py-2 text-xs"
          style={{ background: "rgba(13,17,23,0.92)", color: "var(--text-primary)" }}
        >
          {t("trips:detail.map.buildError")}
        </p>
      )}
      {cruiseGeometryFailed && (
        <MapLoadFailedNotice
          messageKey="map:loadFailed.cruiseRoutes"
          onRetry={retryCruiseGeometry}
        />
      )}
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
          extras={globeStationLabels}
          mode="important"
        />
      )}
      {empty && (
        <div
          className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none px-6 text-center"
          style={{ color: "var(--text-muted)", background: "rgba(13,17,23,0.5)" }}
        >
          {t(trip.emptyKey ?? "trips:detail.map.empty")}
        </div>
      )}
      <button
        type="button"
        onClick={toggleProjection}
        className="absolute top-3 right-3 px-3 py-1.5 rounded-full text-xs font-medium transition-colors pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:min-w-(--ts-size-touch-min)"
        style={{
          background: "rgba(13,17,23,0.85)",
          backdropFilter: "blur(6px)",
          border: "1px solid var(--color-border)",
          color: projection === "globe" ? "var(--accent)" : "var(--text-muted)",
        }}
        aria-pressed={projection === "globe"}
        title={t("trips:detail.map.toggleProjectionHint")}
      >
        {t(`trips:detail.map.${projection === "globe" ? "projectionGlobe" : "projectionFlat"}`)}
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
