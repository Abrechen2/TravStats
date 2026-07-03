import { ArcLayer } from "@deck.gl/layers";

// Sky-blue at both ends of upcoming arcs — the single flight-domain view's
// default tip color. Matches SCHEDULED_BLUE in routesLayer.ts.
const DEFAULT_EDGE_COLOR: [number, number, number] = [80, 200, 255];

/** Convert an 8-bit RGB triplet into a GLSL `vec3` literal (0..1 normalised). */
function toGlslVec3(rgb: readonly [number, number, number]): string {
  const [r, g, b] = rgb.map((c) => (c / 255).toFixed(4));
  return `vec3(${r}, ${g}, ${b})`;
}

export interface UpcomingArcLayerExtraProps {
  /**
   * RGB (0-255) tip color for the gradient at both arc ends. Defaults to
   * the sky-blue used by the single flight-domain view. The two-tone
   * "Alle" view passes gold here so the mixed-route tips read consistently
   * with the two-tone pure-scheduled color (see routesLayer.ts).
   */
  edgeColor?: [number, number, number];
}

/**
 * ArcLayer subclass that renders the same arc geometry but applies a
 * symmetric edge-tipped gradient: hardcoded red (or orange, in two-tone)
 * core in the middle, fading to `edgeColor` at BOTH ends. Used for *mixed*
 * routes only — i.e. routes that have ALREADY been flown AND carry an
 * upcoming scheduled flight. The tips on each side "Zahnpasta" the arc into
 * an edge → core → edge stroke that reads as "this route is both lived-in
 * and has more flights coming" without any second visual element.
 *
 * Pure-scheduled routes (upcoming, never flown) skip this layer entirely
 * and render through plain ArcLayer with `SCHEDULED_BLUE` /
 * `FLIGHT_STATUS_UPCOMING_COLOR` (see routesLayer.ts).
 *
 * Implementation: fragment-shader inject only. ArcLayer's existing `uv`
 * varying (uv.x = 0..1 along the arc) is the segment parameter we need;
 * no vertex-shader override required. `edgeColor` is baked directly into
 * the injected GLSL source (not a uniform) — same approach as the
 * previous hardcoded constant, just parameterised per-instance.
 */
export class UpcomingArcLayer<DataT = unknown> extends ArcLayer<
  DataT,
  UpcomingArcLayerExtraProps
> {
  static layerName = "UpcomingArcLayer";
  static defaultProps = {
    ...ArcLayer.defaultProps,
    edgeColor: { type: "array", value: DEFAULT_EDGE_COLOR, compare: true },
  };

  getShaders() {
    const shaders = super.getShaders();
    const edgeColor = this.props.edgeColor ?? DEFAULT_EDGE_COLOR;
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
