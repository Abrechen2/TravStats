import { ArcLayer } from "@deck.gl/layers";

// Sky-blue at both ends of upcoming arcs. Matches SCHEDULED_BLUE in
// routesLayer.ts; expressed as 0..1 normalised RGB literals for GLSL.
const EDGE_COLOR_GLSL = "vec3(0.3137, 0.7843, 1.0000)";

/**
 * ArcLayer subclass that renders the same arc geometry but applies a
 * symmetric blue-tipped gradient: hardcoded red core in the middle, fading
 * to sky-blue at BOTH ends. Used for *mixed* routes only — i.e. routes
 * that have ALREADY been flown AND carry an upcoming scheduled flight. The
 * blue tips on each side "Zahnpasta" the arc into a blue → red → blue
 * stroke that reads as "this route is both lived-in and has more flights
 * coming" without any second visual element.
 *
 * Pure-scheduled routes (upcoming, never flown) skip this layer entirely
 * and render through plain ArcLayer with `SCHEDULED_BLUE` (see
 * routesLayer.ts).
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
        // Symmetric blue-tipped blend. geometry.uv.x is the segment ratio
        // along the arc (0 at source, 1 at target). endProximity is 0 in
        // the middle and 1 at either end. The blend lets the red core come
        // through more strongly (centre = 35% blue mix, was 60%) while
        // still preserving a strongly blue end (≈85% blue at the tips).
        // Result: a clearly readable blue → red → blue gradient.
        "fs:DECKGL_FILTER_COLOR": `
          float endProximity = clamp(abs(geometry.uv.x - 0.5) * 2.0, 0.0, 1.0);
          float blend = 0.35 + 0.5 * smoothstep(0.0, 0.7, endProximity);
          color.rgb = mix(color.rgb, ${EDGE_COLOR_GLSL}, blend);
        `,
      },
    };
  }
}
