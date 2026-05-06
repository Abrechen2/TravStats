import { ArcLayer } from "@deck.gl/layers";

// Sky-blue at both ends of upcoming arcs. Matches SCHEDULED_BLUE in
// routesLayer.ts; expressed as 0..1 normalised RGB literals for GLSL.
const EDGE_COLOR_GLSL = "vec3(0.3137, 0.7843, 1.0000)";

/**
 * ArcLayer subclass that renders the same arc geometry but applies a
 * symmetric gradient: heatmap colour in the middle, fading to sky-blue at
 * BOTH ends. Used for routes carrying at least one scheduled flight — the
 * blue tips on each side "Zahnpasta" the arc into a single multi-coloured
 * stroke that reads as "scheduled" without any second visual element.
 *
 * Implementation: fragment-shader inject only. ArcLayer's existing `uv`
 * varying (uv.x = 0..1 along the arc) is the segment parameter we need;
 * no vertex-shader override required.
 */
export class UpcomingArcLayer<DataT = unknown> extends ArcLayer<DataT> {
  static layerName = "UpcomingArcLayer";

  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      inject: {
        ...(shaders.inject || {}),
        // Symmetric blue-leaning blend. geometry.uv.x is the segment ratio
        // along the arc (0 at source, 1 at target). endProximity is 0 in
        // the middle and 1 at either end. The blend keeps a baseline blue
        // tint everywhere (45%) and ramps to full blue at the ends — the
        // arc reads as "primarily scheduled, with a heatmap-tinted core"
        // rather than "heatmap with blue tips".
        "fs:DECKGL_FILTER_COLOR": `
          float endProximity = clamp(abs(geometry.uv.x - 0.5) * 2.0, 0.0, 1.0);
          float blend = 0.6 + 0.4 * smoothstep(0.0, 0.7, endProximity);
          color.rgb = mix(color.rgb, ${EDGE_COLOR_GLSL}, blend);
        `,
      },
    };
  }
}
