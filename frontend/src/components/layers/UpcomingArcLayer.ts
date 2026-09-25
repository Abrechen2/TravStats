import { ArcLayer } from "@deck.gl/layers";
import type { UpdateParameters } from "@deck.gl/core";
import { FLIGHT_STATUS_UPCOMING_COLOR } from "../../lib/statusColors";

// Fallback tip colour for callers that don't pass one. Production callers
// always pass `edgeColor` — resolved from the user's flight-colour config via
// `resolveFlightTipColor` (see routesLayer.ts) — so this is only a safety net.
const DEFAULT_EDGE_COLOR: [number, number, number] = FLIGHT_STATUS_UPCOMING_COLOR;

/** Two tip colours are the same colour. Compared component-wise because the
 *  caller builds a fresh array on every resolve, so identity says nothing. */
function sameEdgeColor(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * Whether the model has to be rebuilt for the tip colour to reach the screen.
 *
 * Its own function because it is the whole rule, and the layer method around
 * it cannot be exercised without a GPU device: `baked` is what `getShaders()`
 * last wrote into the GLSL source, `wanted` is what the props ask for now.
 */
export function edgeColorNeedsRebuild(
  baked: readonly [number, number, number],
  wanted: readonly [number, number, number]
): boolean {
  return !sameEdgeColor(baked, wanted);
}

/** Convert an 8-bit RGB triplet into a GLSL `vec3` literal (0..1 normalised). */
function toGlslVec3(rgb: readonly [number, number, number]): string {
  const [r, g, b] = rgb.map((c) => (c / 255).toFixed(4));
  return `vec3(${r}, ${g}, ${b})`;
}

export interface UpcomingArcLayerExtraProps {
  /**
   * RGB (0-255) tip colour for the gradient at both arc ends. Callers pass
   * the user's planned colour for the active flight-colour mode — see
   * `resolveFlightTipColor` in `lib/flightColor.ts`.
   */
  edgeColor?: [number, number, number];
}

/**
 * ArcLayer subclass that renders the same arc geometry but applies a
 * symmetric edge-tipped gradient: the route's flown colour in the core,
 * fading to `edgeColor` (the planned colour) at BOTH ends. Used for *mixed*
 * routes only — i.e. routes that have ALREADY been flown AND carry an upcoming
 * scheduled flight. The tips on each side "Zahnpasta" the arc into an
 * edge → core → edge stroke that reads as "this route is both lived-in and has
 * more flights coming" without any second visual element.
 *
 * Pure-scheduled routes (upcoming, never flown) skip this layer entirely and
 * render through a plain ArcLayer in the flat planned colour (routesLayer.ts).
 *
 * Implementation: fragment-shader inject only. ArcLayer's existing `uv`
 * varying (uv.x = 0..1 along the arc) is the segment parameter we need;
 * no vertex-shader override required. `edgeColor` is baked directly into
 * the injected GLSL source (not a uniform) — same approach as the
 * previous hardcoded constant, just parameterised per-instance.
 */
export class UpcomingArcLayer<DataT = unknown> extends ArcLayer<DataT, UpcomingArcLayerExtraProps> {
  static layerName = "UpcomingArcLayer";
  static defaultProps = {
    ...ArcLayer.defaultProps,
    edgeColor: { type: "array", value: DEFAULT_EDGE_COLOR, compare: true },
  };

  /**
   * The colour currently COMPILED INTO the fragment shader, which is not
   * necessarily `props.edgeColor` — see `updateState`.
   */
  private bakedEdgeColor: readonly [number, number, number] = DEFAULT_EDGE_COLOR;

  /**
   * Rebuild the model when the tip colour changes.
   *
   * `edgeColor` is baked into the injected GLSL below rather than passed as a
   * uniform, and deck.gl calls `getShaders()` only when it BUILDS the model —
   * so without this, a new planned colour reached the screen only on the next
   * full rebuild. The user-visible symptom, reported by the tester on
   * 2026-09-20: picking a new "geflogen" colour repainted at once (it travels
   * in the arc data) while "geplant" did nothing until a page reload or a trip
   * through another colour mode, both of which rebuild the layer anyway. It
   * showed on mixed routes — flown AND with a flight still to come — which is
   * what most planned flights sit on, and only in the default "arc" route
   * shape; the "flat" shape puts the same colour in its data
   * (`flatRoutesLayer.ts`) and never had the lag.
   *
   * The parent already does exactly this for `extensionsChanged`; comparing
   * against what was baked rather than against `oldProps` keeps the two from
   * rebuilding twice for one change, and costs nothing on mount, where the
   * shader was just built from the current props.
   */
  updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    const wanted = this.props.edgeColor ?? DEFAULT_EDGE_COLOR;
    if (!edgeColorNeedsRebuild(this.bakedEdgeColor, wanted)) return;
    // No model yet means nothing has been compiled: the build that follows
    // reads the current props by itself, and destroying nothing would throw.
    const model = this.state?.model;
    if (!model) return;
    model.destroy();
    this.state.model = this._getModel();
    this.getAttributeManager()?.invalidateAll();
  }

  getShaders() {
    const shaders = super.getShaders();
    const edgeColor = this.props.edgeColor ?? DEFAULT_EDGE_COLOR;
    this.bakedEdgeColor = edgeColor;
    return {
      ...shaders,
      inject: {
        ...(shaders.inject || {}),
        // Symmetric edge-tipped blend. geometry.uv.x is the segment ratio
        // along the arc (0 at source, 1 at target). endProximity is 0 in
        // the middle and 1 at either end. The blend lets the core color
        // come through more strongly (centre = 35% edge mix, was 60%)
        // while still preserving a strongly-tinted end (≈85% edge mix at
        // the tips). Result: a clearly readable edge → core → edge
        // gradient.
        "fs:DECKGL_FILTER_COLOR": `
          float endProximity = clamp(abs(geometry.uv.x - 0.5) * 2.0, 0.0, 1.0);
          float blend = 0.35 + 0.5 * smoothstep(0.0, 0.7, endProximity);
          color.rgb = mix(color.rgb, ${toGlslVec3(edgeColor)}, blend);
        `,
      },
    };
  }
}
