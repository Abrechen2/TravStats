// Factory for the deck.gl layer stack rendered by GlobeView.
// Extracted from the inline `useMemo` body so the React component shell
// stays focused on state + UI and the layer construction can be read
// (and reasoned about) on its own.
//
// All inputs are explicit — no closures over component state. The
// caller wraps this in `useMemo` and supplies the same dependency list
// it would have used inline; nothing in here depends on render scope.

import { ColumnLayer, PathLayer } from "@deck.gl/layers";
import { PathStyleExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import {
  RECORDED_GAP_ALPHA_SHARE,
  RECORDED_GAP_DASH,
  RECORDED_GAP_WIDTH_PX,
  RECORDED_SOLID_WIDTH_PX,
} from "../layers/recordedFlightPaths";
import type { Layer, PickingInfo } from "@deck.gl/core";
import {
  EarthOcclusionExtension,
  type EarthOcclusionExtensionProps,
} from "./EarthOcclusionExtension";
import type { Quartile } from "./heatmapUtils";
import type { ArcDatum, GlobePinned, PointDatum } from "./globeLayerTypes";
import {
  resolveFlightColor,
  tierFromQuartile,
  type FlightColorConfig,
} from "../../lib/flightColor";
import { resolveCruisePathColor } from "./cruisePathColor";

export { resolveCruisePathColor };

// Default marker appearance — exported so GlobeView can seed the user
// customisation state from the same source of truth. Airports + ports
// are pixel-sized via ScatterplotLayer so they stay a constant
// on-screen size regardless of zoom (the ColumnLayer variant ballooned
// to city-covering pillars at high zoom).
export const DEFAULT_AIRPORT_COLOR: [number, number, number] = [251, 191, 36];
// Brand cruise blue (BRAND.md §3, --domain-cruise) — same default as the
// flat-map port markers + cruise routes so ports read identically on both
// maps. Was sky-400 [56,189,248], a different blue outside the palette.
export const DEFAULT_PORT_COLOR: [number, number, number] = [111, 160, 214];
export const DEFAULT_MARKER_RADIUS_PX = 5;

/**
 * Resolve a flight arc's render color for the globe.
 *
 * Delegates to `resolveFlightColor` — the SAME function the flat map's
 * `routesLayer.ts` uses — so the two renderers cannot drift on what a given
 * route looks like in a given mode. The globe already carries a pre-computed
 * `quartile` per arc; it maps 1:1 onto the shared frequency tier.
 *
 * Exported as a pure function (no deck.gl / React dependency) so it's
 * unit-testable in isolation.
 */
export function resolveFlightArcColor(
  arc: Pick<ArcDatum, "status" | "quartile">,
  colorConfig: FlightColorConfig
): [number, number, number] {
  return resolveFlightColor(
    {
      tier: tierFromQuartile(arc.quartile),
      pureScheduled: arc.status === "scheduled",
    },
    colorConfig
  );
}
// Head-flight arrival marker keeps a little 3-D pop via ColumnLayer,
// but airports + ports go flat. The numbers below are only used by
// the head-flight column.
const HEAD_MARKER_HEIGHT_M = 90_000;
// Radius is in PIXELS (radiusUnits: "pixels" below) — a touch larger than
// the ~5 px airport dots so the live-mode head marker pops. This was
// previously 10_000 ("meters" by the name) but read as 10 000 *pixels*,
// painting a canvas-filling amber disk the moment live mode drew a head
// marker (the scrub-time full-screen amber flood).
const HEAD_MARKER_RADIUS_PX = 8;

// Only the TRIP map's globe (Trips/TripMapGlobeLayers.ts) still lifts its dots
// and cruise legs with the two altitudes below; the main globe draws them as
// native MapLibre layers on the surface (Globe/native/, forgejo#331) and needs
// neither. They go when the trip map does.
//
// Lift cruise paths a few km off the sphere surface so they don't
// z-fight with / clip into the globe. The path geometry comes from the
// backend as 2-D `[lng, lat]` (sea-route GeoJSON); without an altitude
// component, deck.gl renders it at exactly altitude 0 which shares
// depth-buffer values with the sphere mesh and produces the clipping
// the user observed. 5 km is invisible at any user-relevant zoom but
// safely above the precision noise of the fragment depth.
//
// Exported because the TRIP map's globe (Trips/TripMapGlobeLayers.ts) draws
// the same two things at the same two heights. A second copy of the number is
// a second thing to get wrong, and the symptom — a cruise line sinking into
// the sphere — reads as a rendering bug rather than a drifted constant.
export const CRUISE_PATH_ALTITUDE_M = 5_000;
// Airport + port markers (and their labels) lift slightly above the
// cruise-path altitude so they render ON TOP of cruise paths rather
// than getting visually clipped where a path intersects the marker.
// Beta.22 had markers at altitude 0 → cruise paths drew over them at
// shallow camera angles. 8 km is well above the 5 km cruise altitude
// but still hugs the surface visually. Exported for the trip map's globe, for
// the same reason as CRUISE_PATH_ALTITUDE_M above.
export const MARKER_ALTITUDE_M = 8_000;

// Convert a deck.gl PickingInfo.coordinate into a [lng, lat] pair so we
// can anchor the popup where the user actually clicked the line. The
// coordinate is `number[]` of length ≥ 2 in deck.gl's typing — pull
// the first two numbers. Falls back to the path's midpoint if the
// pick didn't carry a coordinate, which can happen for offscreen
// picks or when the pipeline doesn't compute one.
function pickingCoordToLngLat(
  coordinate: number[] | undefined,
  fallbackPath: ReadonlyArray<readonly number[]>
): [number, number] {
  if (coordinate && coordinate.length >= 2) {
    return [coordinate[0], coordinate[1]];
  }
  const mid = fallbackPath[Math.floor(fallbackPath.length / 2)];
  if (mid && mid.length >= 2) return [mid[0], mid[1]];
  return [0, 0];
}

export interface BuildGlobeLayersOptions {
  arcsData: ArcDatum[];
  antipodalArcs: ArcDatum[];
  headFlightArc: ArcDatum | null;
  activeQuartile: Quartile | null;
  lite: boolean;
  occlusionExt: EarthOcclusionExtension;
  occlusionProps: EarthOcclusionExtensionProps;
  onArcHover: (info: PickingInfo<ArcDatum>) => void;
  setPinned: (pinned: GlobePinned | null) => void;
  /**
   * True when a native layer (a dot, a cruise path) lies under the screen
   * point. A native feature wins the pointer over an arc passing beneath it —
   * the dots were drawn above the arcs, and picked first, before they moved
   * off deck.gl.
   */
  isOverNative?: (x: number, y: number) => boolean;
  /**
   * The user's flight-colour mode + colours (`store/flightColorStore`). The
   * only thing that decides a flight arc's hue — identical to the flat map,
   * via the shared `resolveFlightColor`. The active-quartile filter still
   * dims non-matching arcs via alpha, so it keeps working in every mode.
   */
  flightColorConfig: FlightColorConfig;
  /** User multiplier on flight-arc line width (1 = default). */
  arcWidthScale: number;
}

/**
 * The deck.gl half of the globe: flight arcs, which are the one thing that
 * genuinely leaves the ground. Everything on the ground — airport, port,
 * lodging and place dots, cruise paths, the night shade, the caller's rail /
 * bus / tour lines — is a native MapLibre layer (`Globe/native/`), so it sits on
 * the surface instead of floating above it (forgejo#331).
 */
export function buildGlobeLayers(opts: BuildGlobeLayersOptions): Layer[] {
  const {
    arcsData,
    antipodalArcs,
    headFlightArc,
    activeQuartile,
    lite,
    occlusionExt,
    occlusionProps,
    onArcHover,
    setPinned,
    isOverNative,
    flightColorConfig,
    arcWidthScale,
  } = opts;
  // A pointer over a native dot/line belongs to that layer, not to an arc
  // passing under it.
  const hoverArc = (info: PickingInfo<ArcDatum>): void => {
    if (isOverNative && info.x != null && info.y != null && isOverNative(info.x, info.y)) return;
    onArcHover(info);
  };
  const pinArc = (info: PickingInfo<ArcDatum>): void => {
    const object = info.object;
    if (!object) return;
    if (isOverNative && info.x != null && info.y != null && isOverNative(info.x, info.y)) return;
    const anchor = pickingCoordToLngLat(info.coordinate, object.waypoints);
    setPinned({ kind: "arc", data: object, anchorLngLat: anchor });
    // No flyToArc here. The popup is anchored to the click coordinate, so
    // flying the camera away from where the user tapped is an anti-pattern,
    // and stacking a 1.5 s flyTo on top of the popup mount + globe re-render
    // was crashing the canvas in some camera states (regression on beta.15).
  };
  // Per-arc colour — resolved through the shared `resolveFlightColor` (see
  // `resolveFlightArcColor`), so the globe and the flat map agree on every
  // mode. Active-quartile alpha dimming is preserved on top so the
  // click-to-isolate filter still reads visually in all modes.
  const arcColor = (d: ArcDatum, baseAlpha: number): [number, number, number, number] => {
    const rgb = resolveFlightArcColor(d, flightColorConfig);
    return [rgb[0], rgb[1], rgb[2], baseAlpha];
  };

  return [
    // Flight arcs as PathLayer with pre-tessellated great-circle
    // waypoints. ArcLayer.greatCircle is broken on globe projection
    // (height computed in screen-space → invisible) — explicit
    // waypoints sidestep the issue and the curve looks identical.
    // Dash extension renders metadata-weak arcs (aggregated without
    // an IATA match) as dashed; strong arcs get [0,0] which the
    // extension treats as solid. EarthOcclusionExtension provides
    // per-fragment horizon clipping in the GPU.
    new PathLayer<ArcDatum>({
      id: "globe-flight-arcs",
      data: arcsData,
      getPath: (d) => d.waypoints,
      getColor: (d) => {
        const alpha = activeQuartile === null || activeQuartile === d.quartile ? 235 : 35;
        return arcColor(
          d,
          d.recorded === "gap" ? Math.round(alpha * RECORDED_GAP_ALPHA_SHARE) : alpha
        );
      },
      // Match the flat-map routes-layer formula so flight-arc thickness
      // is consistent across map ↔ globe transitions: sqrt(count) px,
      // 1 flight → 1 px, 16 flights → 4 px (cap), then the user width
      // multiplier. A recorded flight's line is ONE flight, so it takes the
      // flat map's fixed recorded widths instead.
      getWidth: (d) =>
        (d.recorded === "gap"
          ? RECORDED_GAP_WIDTH_PX
          : d.recorded === "solid"
            ? RECORDED_SOLID_WIDTH_PX
            : Math.min(Math.sqrt(d.count), 4)) * arcWidthScale,
      updateTriggers: {
        getColor: [activeQuartile, flightColorConfig],
        getWidth: [arcWidthScale],
      },
      widthUnits: "pixels",
      widthMinPixels: 1 * arcWidthScale,
      widthMaxPixels: 4 * arcWidthScale,
      capRounded: true,
      jointRounded: true,
      // Waypoints are pre-unwrapped (lng can exceed ±180 to stay
      // monotone across the antimeridian). PathLayer's own wrapping
      // would cut them at ±180 and create the phantom-ring artifact.
      wrapLongitude: false,
      pickable: true,
      autoHighlight: !lite,
      highlightColor: [255, 255, 255, 180],
      onHover: hoverArc,
      onClick: pinArc,
      extensions: [new PathStyleExtension({ dash: true, highPrecisionDash: true }), occlusionExt],
      getDashArray: (d: ArcDatum) =>
        d.recorded === "gap"
          ? RECORDED_GAP_DASH
          : d.recorded === undefined && d.weak
            ? [4, 3]
            : [0, 0],
      dashJustified: true,
      dashGapPickable: false,
      ...occlusionProps,
    } as ConstructorParameters<typeof PathLayer<ArcDatum>>[0] &
      PathStyleExtensionProps<ArcDatum> &
      EarthOcclusionExtensionProps),
    // Antipodal routes (>= ANTIPODAL_DISTANCE_KM) — flat surface
    // line at altitude 0, narrower than normal arcs and slightly
    // muted, so the route still appears visually but doesn't grab
    // the eye like a real arc would. Counter shown in the legend.
    new PathLayer<ArcDatum>({
      id: "globe-flight-arcs-antipodal",
      data: antipodalArcs,
      getPath: (d) => d.waypoints,
      getColor: (d) =>
        arcColor(d, activeQuartile === null || activeQuartile === d.quartile ? 160 : 25),
      updateTriggers: { getColor: [activeQuartile, flightColorConfig] },
      getWidth: 1,
      widthUnits: "pixels",
      widthMinPixels: 1,
      widthMaxPixels: 1.5,
      capRounded: true,
      jointRounded: true,
      wrapLongitude: false,
      pickable: true,
      autoHighlight: !lite,
      highlightColor: [255, 255, 255, 180],
      onHover: hoverArc,
      onClick: pinArc,
      extensions: [occlusionExt],
      ...occlusionProps,
    } as ConstructorParameters<typeof PathLayer<ArcDatum>>[0] & EarthOcclusionExtensionProps),
    // NOTE: IATA / UN-LOCODE labels are intentionally NOT a deck.gl
    // TextLayer here. deck.gl 9's billboard TextLayer/IconLayer does not
    // render under MapLibre's globe projection in interleaved mode (the
    // identical layer renders fine on the flat mercator map). Labels are
    // drawn instead as an HTML overlay — see `GlobeLabelsOverlay`, which
    // projects each marker to screen space with the same front-face cull
    // as the pinned card.
    // Live-mode "head" highlight: bright orange overlay on the most
    // recent flight in the live window. Drawn AFTER everything else so
    // it visually pops above the heatmap. Pickable so the user can
    // still click it.
    ...(headFlightArc
      ? [
          new PathLayer<ArcDatum>({
            id: "globe-flight-head",
            data: [headFlightArc],
            getPath: (d) => d.waypoints,
            getColor: arcColor(headFlightArc, 245),
            getWidth: 5,
            widthUnits: "pixels",
            widthMinPixels: 4,
            widthMaxPixels: 6,
            capRounded: true,
            jointRounded: true,
            wrapLongitude: false,
            pickable: true,
            autoHighlight: !lite,
            highlightColor: [255, 255, 255, 220],
            onHover: hoverArc,
            onClick: pinArc,
            extensions: [occlusionExt],
            ...occlusionProps,
          } as ConstructorParameters<typeof PathLayer<ArcDatum>>[0] & EarthOcclusionExtensionProps),
          // Head endpoint dot — column at the arrival airport of the
          // most-recent flight, so the eye lands on "where the trail
          // ends right now".
          new ColumnLayer<PointDatum>({
            id: "globe-flight-head-marker",
            data: [
              {
                position: headFlightArc.to,
                size: 1,
                iata: headFlightArc.arrival.iata ?? "",
                name: headFlightArc.arrival.name ?? "",
              },
            ],
            getPosition: (d) => d.position,
            getFillColor: [240, 169, 71, 235],
            getElevation: HEAD_MARKER_HEIGHT_M,
            elevationScale: 1,
            radius: HEAD_MARKER_RADIUS_PX,
            radiusUnits: "pixels",
            diskResolution: lite ? 8 : 16,
            extruded: false,
            material: false,
            pickable: false,
            extensions: [occlusionExt],
            ...occlusionProps,
          } as ConstructorParameters<typeof ColumnLayer<PointDatum>>[0] &
            EarthOcclusionExtensionProps),
        ]
      : []),
  ];
}
