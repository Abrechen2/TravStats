import { ArcLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { GeoJSONFeature } from "../../types";
import { calcQuantiles } from "./layerTypes";
import type { ArcDatum, PointDatum } from "./layerTypes";
import type { MapLayerColors } from "../../types/mapTheme";
import { UpcomingArcLayer } from "./UpcomingArcLayer";
import { declutterByDistance, pickLabelled, type LabelsMode } from "../map/labelPriority";
import {
  DEFAULT_FLIGHT_COLOR_CONFIG,
  frequencyTier,
  resolveFlightColor,
  resolveFlightTipColor,
  type FlightColorConfig,
} from "../../lib/flightColor";
import { DEFAULT_FLIGHT_ROUTE_SHAPE, type FlightRouteShape } from "../../lib/flightRouteShape";
import { isCountableFlight } from "../../shared/flightCounting";
import { buildFlatRoutes, createFlatRoutesLayer } from "./flatRoutesLayer";
import { markerDotRadiusProps } from "./markerDotStyle";

function routeKey(a: string, b: string): string {
  return [a, b].sort().join("-");
}

function getCoordsFromFeature(
  f: GeoJSONFeature
): { depCoord: [number, number]; arrCoord: [number, number] } | null {
  const coords = f.geometry.coordinates;
  if (!coords || coords.length < 2) return null;
  return {
    depCoord: coords[0] as [number, number],
    arrCoord: coords[coords.length - 1] as [number, number],
  };
}

type AirportProps = GeoJSONFeature["properties"]["departureAirport"];

// Stable per-airport identifier used to collapse bidirectional routes. IATA
// is preferred (human-readable, matches the rendered label), then ICAO for
// airfields that never got an IATA assignment (common for small / pre-1990
// airports), then a coordinate-derived key as a last resort so a flight with
// valid geometry still renders even when both codes are missing.
//
// Issue #120: the old gate `if (!dep.iata || !arr.iata) continue` silently
// dropped 1986-era manual entries to ICAO-only fields — they have valid
// coordinates (depLat/depLon are non-nullable, so the flight saves) but a
// null IATA (depIata is nullable), so they vanished from the map entirely.
function airportId(airport: AirportProps, coord: [number, number]): string {
  return airport.iata || airport.icao || `@${coord[0].toFixed(3)},${coord[1].toFixed(3)}`;
}

// Human-readable airport label for the map marker / aggregation map. Falls
// back through IATA → ICAO → name → "—" so a code-less airport still shows
// something meaningful instead of an empty pill.
function airportLabel(airport: AirportProps): string {
  return airport.iata || airport.icao || airport.name || "—";
}

// Dim alpha for grey historical routes (only reachable in "frequency" mode —
// see resolveFlightColor). Live routes ramp their alpha with frequency.
const HISTORICAL_ALPHA = 140;

interface RouteRecord {
  key: string;
  // First-seen coordinates for this canonical route. Either direction of
  // FRA-MUC vs MUC-FRA collapses to the same record, so the arc uses the
  // first-seen flight's geometry — that's fine for a directionless display.
  depCoord: [number, number];
  arrCoord: [number, number];
  // First-seen departure/arrival identity — surfaced in the hover tooltip.
  depAirport: AirportProps;
  arrAirport: AirportProps;
  count: number;
  // Status-aware split of `count`. `count` itself keeps its all-statuses
  // meaning (width/frequency-tier/min-route-filter semantics unchanged) —
  // these two are additive breakdowns threaded through to ArcDatum for the
  // hover tooltip, so a planned flight is never presented as flown.
  flownCount: number;
  scheduledCount: number;
  flightIds: string[];
  hasUpcoming: boolean;
  // True when at least one flight on this canonical pair has status !==
  // 'scheduled' (i.e. it has actually been flown — flown / cancelled /
  // historical / duplicated all count). Combined with `hasUpcoming` to
  // distinguish "pure-scheduled" (blue) from "mixed" (blue-tipped red).
  hasPastFlown: boolean;
  // True when every flight on this canonical pair is `status: 'historical'`.
  // Used to fade the arc to the dim grey treatment.
  allHistorical: boolean;
}

function aggregateAllRoutes(flights: GeoJSONFeature[]): Map<string, RouteRecord> {
  const records = new Map<string, RouteRecord>();
  for (const f of flights) {
    const dep = f.properties.departureAirport;
    const arr = f.properties.arrivalAirport;
    const coords = getCoordsFromFeature(f);
    if (!coords) continue;
    // Identify each airport by IATA → ICAO → coordinate key so ICAO-only /
    // code-less airfields still aggregate instead of being dropped (#120).
    const key = routeKey(airportId(dep, coords.depCoord), airportId(arr, coords.arrCoord));
    const isScheduled = f.properties.status === "scheduled";
    const isFlown = isCountableFlight(f.properties);
    const isHistorical = f.properties.status === "historical";
    const existing = records.get(key);
    if (existing) {
      existing.count += 1;
      existing.flightIds.push(f.properties.id);
      if (isScheduled) existing.scheduledCount += 1;
      if (isFlown) existing.flownCount += 1;
      if (isScheduled) existing.hasUpcoming = true;
      if (!isScheduled) existing.hasPastFlown = true;
      if (!isHistorical) existing.allHistorical = false;
    } else {
      records.set(key, {
        key,
        depCoord: coords.depCoord,
        arrCoord: coords.arrCoord,
        depAirport: dep,
        arrAirport: arr,
        count: 1,
        flownCount: isFlown ? 1 : 0,
        scheduledCount: isScheduled ? 1 : 0,
        flightIds: [f.properties.id],
        hasUpcoming: isScheduled,
        hasPastFlown: !isScheduled,
        allHistorical: isHistorical,
      });
    }
  }
  return records;
}

function buildArcs(
  records: Map<string, RouteRecord>,
  minRouteCount: number,
  /**
   * The user's flight-colour mode + colours (`store/flightColorStore`).
   * The ONLY thing that decides an arc's hue — there is no second override
   * path any more. Every branch below routes through `resolveFlightColor`,
   * so whatever the user picked is what gets rendered, in every view.
   */
  colorConfig: FlightColorConfig
): ArcDatum[] {
  const counts = [...records.values()].map((r) => r.count);
  const { q25, q50, q75 } = calcQuantiles(counts.length > 0 ? counts : [0]);
  const arcs: ArcDatum[] = [];

  for (const r of records.values()) {
    if (r.count < minRouteCount) continue;

    // A route is "pure-scheduled" when it carries an upcoming flight and has
    // never been flown. A MIXED route (flown + upcoming) counts as flown: its
    // core takes the flown colour, and UpcomingArcLayer fades the planned
    // colour in at both tips (see `resolveFlightTipColor`).
    const pureScheduled = r.hasUpcoming && !r.hasPastFlown;
    const color = resolveFlightColor(
      {
        tier: frequencyTier(r.count, q25, q50, q75),
        pureScheduled,
        isHistorical: r.allHistorical,
      },
      colorConfig
    );

    // Grey historical routes (frequency mode only) stay dim in the background.
    // Everything else ramps opacity with frequency, with a visibility floor so
    // a single long-haul in an empty ocean still reads clearly on its own.
    const isGreyHistorical = colorConfig.mode === "frequency" && r.allHistorical;
    const alpha = isGreyHistorical
      ? HISTORICAL_ALPHA
      : Math.min((pureScheduled ? 140 : 160) + r.count * 14, 230);

    // sourceColor === targetColor: arc is uniform colour at the data layer.
    // Mixed-route planned tips are added by UpcomingArcLayer's fragment shader.
    const argb = [...color, alpha] as [number, number, number, number];
    arcs.push({
      sourcePosition: r.depCoord,
      targetPosition: r.arrCoord,
      count: r.count,
      flownCount: r.flownCount,
      scheduledCount: r.scheduledCount,
      sourceColor: argb,
      targetColor: argb,
      flightIds: r.flightIds,
      hasUpcoming: r.hasUpcoming,
      hasPastFlown: r.hasPastFlown,
      isHistorical: r.allHistorical,
      departure: {
        iata: r.depAirport.iata,
        icao: r.depAirport.icao,
        name: r.depAirport.name,
        city: r.depAirport.city,
        country: r.depAirport.country,
      },
      arrival: {
        iata: r.arrAirport.iata,
        icao: r.arrAirport.icao,
        name: r.arrAirport.name,
        city: r.arrAirport.city,
        country: r.arrAirport.country,
      },
    });
  }
  return arcs;
}

function buildAirportPoints(flights: GeoJSONFeature[]): PointDatum[] {
  const airportMap = new Map<string, PointDatum>();
  const bumpLastVisit = (
    cur: string | undefined,
    candidate: string | undefined
  ): string | undefined => {
    if (!candidate) return cur;
    if (!cur || candidate > cur) return candidate;
    return cur;
  };
  for (const f of flights) {
    const dep = f.properties.departureAirport;
    const arr = f.properties.arrivalAirport;
    const coords = getCoordsFromFeature(f);
    if (!coords) continue;
    // A scheduled flight is a future flight — it must never bump "Letzter
    // Besuch" into the future. `count` stays all-status (its label "Flüge"
    // is neutral); only the visit timestamp is status-gated.
    const departureTime =
      f.properties.status !== "scheduled" ? (f.properties.departureTime ?? undefined) : undefined;
    // Key by IATA → ICAO → coordinate key so code-less airports still get a
    // marker (#120). The displayed label falls back the same way.
    const depKey = airportId(dep, coords.depCoord);
    const arrKey = airportId(arr, coords.arrCoord);

    if (!airportMap.has(depKey)) {
      airportMap.set(depKey, {
        position: coords.depCoord,
        count: 0,
        name: dep.name ?? airportLabel(dep),
        iata: airportLabel(dep),
        icao: dep.icao,
        country: dep.country,
        city: dep.city,
      });
    }
    if (!airportMap.has(arrKey)) {
      airportMap.set(arrKey, {
        position: coords.arrCoord,
        count: 0,
        name: arr.name ?? airportLabel(arr),
        iata: airportLabel(arr),
        icao: arr.icao,
        country: arr.country,
        city: arr.city,
      });
    }
    const depPoint = airportMap.get(depKey)!;
    const arrPoint = airportMap.get(arrKey)!;
    airportMap.set(depKey, {
      ...depPoint,
      count: depPoint.count + 1,
      lastVisit: bumpLastVisit(depPoint.lastVisit, departureTime),
    });
    airportMap.set(arrKey, {
      ...arrPoint,
      count: arrPoint.count + 1,
      lastVisit: bumpLastVisit(arrPoint.lastVisit, departureTime),
    });
  }
  return [...airportMap.values()];
}

export interface RouteData {
  arcs: ArcDatum[];
  points: PointDatum[];
}

export function buildRouteData(
  flights: GeoJSONFeature[],
  minRouteCount: number,
  colorConfig: FlightColorConfig = DEFAULT_FLIGHT_COLOR_CONFIG
): RouteData {
  // Single arc per canonical airport pair (FRA-MUC === MUC-FRA), regardless
  // of whether the route carries past, scheduled, or mixed flights. Frequency
  // drives width; the user's `colorConfig` drives colour (see flightColor.ts).
  const records = aggregateAllRoutes(flights);
  return {
    arcs: buildArcs(records, minRouteCount, colorConfig),
    points: buildAirportPoints(flights),
  };
}

// Amber highlight color — stands out clearly against both dark and light map tiles
const HIGHLIGHT_COLOR: [number, number, number, number] = [245, 158, 11, 255];
// How many alpha units to keep for dimmed routes (out of 255)
const DIM_ALPHA = 18;

/**
 * Build the deck.gl layer instances for routes mode from already-computed
 * arc + point + upcoming-marker data. Caller is expected to memoize
 * `buildRouteData()`'s output separately with stable deps (flights /
 * minRouteCount / themeColors / paletteOverride) so selection changes don't
 * re-trigger the expensive data build — only the layer construction below,
 * which is cheap.
 */
/** User appearance overrides for the flat routes map (mirrors the globe's
 *  "Anpassung" panel). All optional — omitted fields keep the defaults. */
export interface RoutesAppearance {
  /** Airport marker fill colour (RGB). Falls back to the theme colour. */
  markerColor?: [number, number, number];
  /** Multiplier on the airport marker + ring radii (1 = default). */
  markerSizeScale?: number;
  /** Multiplier on flight-arc width (1 = default). */
  arcWidthScale?: number;
  /** Marker-label reveal: off / key markers only (priority by frequency,
   *  the default) / all. Replaces the old hard zoom gate. */
  labelsMode?: LabelsMode;
  /** How flight routes are drawn (#183): the 3D arcs (default, unchanged) or
   *  flat on the map surface like cruise routes. Flat-map-only — the globe
   *  never reads this. See `lib/flightRouteShape.ts`. */
  routeShape?: FlightRouteShape;
}

export function createRoutesLayers(
  routeData: RouteData,
  onFlightClick?: (flightId: string | string[]) => void,
  themeColors?: MapLayerColors,
  arcHeight: number = 1,
  selectedIds: string[] = [],
  onAirportClick?: (iata: string, lon: number, lat: number) => void,
  zoom: number = 5,
  appearance: RoutesAppearance = {},
  /**
   * The same `FlightColorConfig` passed to `buildRouteData`. Used here only
   * to tint the mixed-route `UpcomingArcLayer` tips (the arc bodies already
   * carry their resolved colour in the data), so the tips follow the user's
   * planned colour in every mode.
   */
  colorConfig: FlightColorConfig = DEFAULT_FLIGHT_COLOR_CONFIG
): Layer[] {
  const { arcs, points } = routeData;
  const {
    markerColor,
    markerSizeScale = 1,
    arcWidthScale = 1,
    labelsMode = "important",
    routeShape = DEFAULT_FLIGHT_ROUTE_SHAPE,
  } = appearance;
  const dotRgb =
    markerColor ?? themeColors?.airportDot ?? ([240, 169, 71] as [number, number, number]);

  const selectedSet = new Set(selectedIds);
  const hasSelection = selectedIds.length > 0;
  // Airport opacity: dim when a route is highlighted so pulse rings stand out
  const airportOpacity = hasSelection ? 0.15 : 1;
  // Priority label reveal: the busiest airports keep their label even when
  // zoomed out; smaller ones fill in as the zoom budget grows.
  // pickLabelled's zoom budget only caps the *count* shown — it has no idea
  // where two labels land on screen, so a cluster of busy airports close
  // together (e.g. MUC/FRA/VIE/ZRH/CDG) can all be "in budget" and still
  // stack on top of each other. declutterByDistance adds real screen-space
  // spacing on top of that budget, favouring the busier airport when two
  // are too close (#label-overlap). Skipped in "all" mode — the user
  // explicitly asked to see every label, overlap included.
  const budgeted = pickLabelled(points, (p) => p.count, labelsMode, zoom);
  const labelPoints =
    labelsMode === "all"
      ? budgeted
      : declutterByDistance(
          budgeted,
          (p) => p.count,
          (p) => p.position,
          zoom
        );

  // Route line width — shared by BOTH shapes so a route is exactly as thick
  // whether it's drawn as an arc or as a flat path. Width follows frequency for
  // live routes; historical-only routes stay visually muted regardless of count
  // so they don't drown out active ones. Cap at 4 px: 1 flight = 1 px, 16
  // flights = max 4 px (smooth ramp across realistic counts).
  const routeWidthPx = (count: number, isHistorical: boolean, selected: boolean): number => {
    if (isHistorical) return 1.2 * arcWidthScale;
    const base = Math.min(Math.sqrt(count) * 1.0, 4) * arcWidthScale;
    // Selected fallback floor matches the unselected cap so a selected mixed
    // route doesn't pop bigger than it.
    return selected ? Math.max(base * 2, 4 * arcWidthScale) : base;
  };

  // Three arc datasets:
  //   - regular: no upcoming flight — heatmap colour through plain ArcLayer.
  //   - pure-scheduled: upcoming, never flown — solid sky-blue through
  //     plain ArcLayer (no shader gradient).
  //   - mixed: upcoming AND has been flown — hardcoded red core through
  //     UpcomingArcLayer which fades blue at both ends.
  // Each route appears exactly once on screen (one line, no overlap).
  const regularArcs = arcs.filter((a) => !a.hasUpcoming);
  const pureScheduledArcs = arcs.filter((a) => a.hasUpcoming && !a.hasPastFlown);
  const mixedArcs = arcs.filter((a) => a.hasUpcoming && a.hasPastFlown);

  // Shared arc props: width, source/target getters, click handler. Used by
  // both the regular and the upcoming layer.
  const sharedArcProps = {
    getSourcePosition: (d: ArcDatum) => d.sourcePosition,
    getTargetPosition: (d: ArcDatum) => d.targetPosition,
    getSourceColor: (d: ArcDatum): [number, number, number, number] => {
      if (!hasSelection) return d.sourceColor;
      const isSelected = d.flightIds.some((id) => selectedSet.has(id));
      if (isSelected) return HIGHLIGHT_COLOR;
      return [d.sourceColor[0], d.sourceColor[1], d.sourceColor[2], DIM_ALPHA];
    },
    getTargetColor: (d: ArcDatum): [number, number, number, number] => {
      if (!hasSelection) return d.targetColor;
      const isSelected = d.flightIds.some((id) => selectedSet.has(id));
      if (isSelected) return HIGHLIGHT_COLOR;
      return [d.targetColor[0], d.targetColor[1], d.targetColor[2], DIM_ALPHA];
    },
    getWidth: (d: ArcDatum) =>
      routeWidthPx(
        d.count,
        !!d.isHistorical,
        hasSelection && d.flightIds.some((id) => selectedSet.has(id))
      ),
    getHeight: arcHeight,
    // Visibility floor: 2 px minimum so a single far-flung route (e.g. a
    // one-off transpacific leg) stays clearly visible at world zoom instead
    // of thinning to a barely-perceptible 1 px hairline.
    widthMinPixels: 2 * arcWidthScale,
    pickable: !!onFlightClick,
    onClick: onFlightClick
      ? ({ object }: { object?: ArcDatum }) => {
          const ids = object?.flightIds;
          if (ids && ids.length > 0) onFlightClick(ids);
        }
      : undefined,
    updateTriggers: {
      getSourceColor: selectedIds,
      getTargetColor: selectedIds,
      getWidth: selectedIds,
    },
  };

  // The route geometry — the user's choice (#183). "arc" is the default and is
  // byte-for-byte the layer stack that shipped before the setting existed.
  //
  // "flat" replaces all THREE arc layers with a single PathLayer of great-circle
  // surface paths (see flatRoutesLayer.ts): the arcs' three-way split exists
  // only because a mixed route needs a custom ArcLayer subclass; a PathLayer
  // encodes the same distinction in its data (a mixed route is split into
  // planned tip / flown core / planned tip), so one layer suffices.
  const routeLayers: Layer[] =
    routeShape === "flat"
      ? [
          createFlatRoutesLayer(buildFlatRoutes(arcs, colorConfig), routeWidthPx, {
            widthScale: arcWidthScale,
            selectedIds,
            highlightColor: HIGHLIGHT_COLOR,
            dimAlpha: DIM_ALPHA,
            onFlightClick,
          }),
        ]
      : [
          new ArcLayer<ArcDatum>({
            id: "routes-arc",
            data: regularArcs,
            ...sharedArcProps,
          }),
          // Pure-scheduled routes — never flown, only an upcoming flight on this
          // pair. Solid planned colour, no shader gradient.
          new ArcLayer<ArcDatum>({
            id: "routes-arc-scheduled",
            data: pureScheduledArcs,
            ...sharedArcProps,
          }),
          // Mixed routes — already flown AND carry an upcoming flight. Flown
          // colour in the core (resolved into the data), planned colour faded in
          // at both tips by UpcomingArcLayer's fragment shader. The tip colour is
          // resolved from the SAME config as the arc bodies, so it follows the
          // user's mode + colours. Layer id kept as `routes-arc-upcoming` for
          // layer-state continuity (selection, picking).
          new UpcomingArcLayer<ArcDatum>({
            id: "routes-arc-upcoming",
            data: mixedArcs,
            edgeColor: resolveFlightTipColor(colorConfig),
            ...sharedArcProps,
          }),
        ];

  // Inner ring — close to the airport dot
  const ringInnerLayer = new ScatterplotLayer<PointDatum>({
    id: "routes-ring-inner",
    data: points,
    getPosition: (d) => d.position,
    getRadius: (d) => Math.min(3 + d.count * 0.4, 10) * 1000 * markerSizeScale,
    updateTriggers: { getRadius: [markerSizeScale], getLineColor: [dotRgb] },
    getFillColor: [0, 0, 0, 0],
    getLineColor: [...dotRgb, 180] as [number, number, number, number],
    stroked: true,
    filled: false,
    lineWidthMinPixels: 1.2,
    opacity: airportOpacity,
    pickable: false,
  });

  // Outer ring — faint halo
  const ringOuterLayer = new ScatterplotLayer<PointDatum>({
    id: "routes-ring-outer",
    data: points,
    getPosition: (d) => d.position,
    getRadius: (d) => Math.min(3 + d.count * 0.4, 10) * 1800 * markerSizeScale,
    updateTriggers: { getRadius: [markerSizeScale], getLineColor: [dotRgb] },
    getFillColor: [0, 0, 0, 0],
    getLineColor: [...dotRgb, 60] as [number, number, number, number],
    stroked: true,
    filled: false,
    lineWidthMinPixels: 0.8,
    opacity: airportOpacity,
    pickable: false,
  });

  // Inner dot — solid center marker. Sizing mirrors the cruise-port dot
  // (`cruise-ports` in cruisePortsLayer.ts) via the shared markerDotStyle
  // module — fixed metre radius + slider-scaled pixel clamps, so the two
  // markers render at the same size for the same size-slider value (#187).
  const dotLayer = new ScatterplotLayer<PointDatum>({
    id: "routes-dot",
    data: points,
    getPosition: (d) => d.position,
    ...markerDotRadiusProps(markerSizeScale),
    // getRadius is now a plain constant (MARKER_DOT_RADIUS_M), not an
    // accessor function of markerSizeScale — no updateTriggers entry
    // needed for it; radiusMinPixels/radiusMaxPixels are plain props and
    // deck.gl diffs those automatically.
    updateTriggers: { getFillColor: [dotRgb] },
    getFillColor: [...dotRgb, 220] as [number, number, number, number],
    stroked: false,
    opacity: airportOpacity,
    pickable: !!onAirportClick,
    onClick: onAirportClick
      ? ({ object }) => {
          if (object?.iata) onAirportClick(object.iata, object.position[0], object.position[1]);
        }
      : undefined,
  });

  // IATA code labels — appear above each marker. Hidden at low zoom levels
  // where overlapping codes become illegible; the marker dots remain visible
  // so users still see airport locations. `labelPoints` above is already
  // decluttered by screen distance (#label-overlap), not just count-budgeted.
  const labelLayer = new TextLayer<PointDatum>({
    id: "routes-labels",
    data: labelPoints,
    getPosition: (d) => d.position,
    getText: (d) => d.iata,
    getSize: 12,
    getColor: [255, 255, 255, 240],
    getBackgroundColor: [22, 27, 34, 210],
    background: true,
    backgroundPadding: [5, 3, 5, 3],
    fontFamily: '"Inter", system-ui, monospace',
    fontWeight: "bold",
    fontSettings: { sdf: true },
    getPixelOffset: [0, -20],
    outlineWidth: 2,
    outlineColor: [0, 0, 0, 120],
    billboard: true,
    // IATA codes are ASCII-only today, but deck.gl's default `characterSet`
    // (32-127) silently drops any glyph outside it from the font atlas
    // (#185 — this bit German port names elsewhere). Keeping "auto" here
    // too so this layer stays correct if it ever renders airport city
    // names or anything else non-ASCII — do not remove.
    characterSet: "auto",
    opacity: airportOpacity,
    visible: labelsMode !== "off",
    pickable: !!onAirportClick,
    onClick: onAirportClick
      ? ({ object }) => {
          if (object?.iata) onAirportClick(object.iata, object.position[0], object.position[1]);
        }
      : undefined,
    parameters: { depthCompare: "always" as const },
  });

  // Render order: routes first (arcs or the flat path), then the airport
  // visuals on top of them.
  return [...routeLayers, ringInnerLayer, ringOuterLayer, dotLayer, labelLayer];
}
