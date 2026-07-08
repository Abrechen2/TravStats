// deck.gl LayerExtension that performs per-vertex Earth-sphere occlusion
// in the GPU. Replaces the JS-side `frontVisibility()` heuristic that
// could only sample 1-3 points per arc and bled through the back of the
// globe.
//
// Math: every vertex is projected onto a unit sphere centered at Earth's
// origin. We compare the angle between (vertex from Earth center) and
// (camera from Earth center) against the geometric horizon angle for
// that camera distance. Vertices beyond the horizon discard their
// fragment. Linear interpolation across triangles/lines gives a clean
// per-fragment fade across the limb.
//
// Coordinate system: relies on `geometry.worldPosition.xy` carrying the
// raw [lng, lat] for LNGLAT-coordinate layers (PathLayer, ColumnLayer,
// IconLayer, etc.). `geometry.worldPosition.z` carries altitude in
// meters, which we convert to Earth radii so high-altitude arcs survive
// the horizon test slightly farther around the limb.
//
// Camera state is pulled from `viewport.longitude/latitude/zoom` inside
// `draw()` every frame, so the uniforms always match the basemap with
// zero React-state round-trip and zero per-frame layer reconstruction.
// This is the difference between arcs that lag the globe rotation by
// one frame (visible wobble at the limb) and arcs that move in lockstep.

import { LayerExtension, type Layer } from "@deck.gl/core";

const EARTH_RADIUS_M = 6371000.0;
const DEG_TO_RAD = Math.PI / 180;

const shaderModuleSource = /* glsl */ `
uniform earthOcclusionUniforms {
  vec3 cameraDir;
  float cosHorizon;
  float fadeBand;
  float altitudeBoost;
  highp int enabled;
} earthOcclusion;
`;

const shaderModule = {
  name: "earthOcclusion",
  vs: shaderModuleSource,
  fs: shaderModuleSource,
  uniformTypes: {
    cameraDir: "vec3<f32>",
    cosHorizon: "f32",
    fadeBand: "f32",
    altitudeBoost: "f32",
    enabled: "i32",
  },
};

const injection = {
  "vs:#decl": /* glsl */ `
out float earthOcclusion_visibility;
`,
  "vs:DECKGL_FILTER_GL_POSITION": /* glsl */ `
{
  vec2 lngLat = geometry.worldPosition.xy;
  float lngR = radians(lngLat.x);
  float latR = radians(lngLat.y);
  vec3 vertDir = vec3(
    cos(latR) * cos(lngR),
    cos(latR) * sin(lngR),
    sin(latR)
  );
  float r = 1.0 + max(geometry.worldPosition.z, 0.0) * earthOcclusion.altitudeBoost;
  float invDist = earthOcclusion.cosHorizon;
  float invR = 1.0 / r;
  float cosThetaMax = invDist * invR
    - sqrt(max(0.0, 1.0 - invDist * invDist))
    * sqrt(max(0.0, 1.0 - invR * invR));
  float dotProd = dot(vertDir, earthOcclusion.cameraDir);
  earthOcclusion_visibility = (dotProd - cosThetaMax) / max(earthOcclusion.fadeBand, 0.0001);
}
`,
  "fs:#decl": /* glsl */ `
in float earthOcclusion_visibility;
`,
  "fs:DECKGL_FILTER_COLOR": /* glsl */ `
if (earthOcclusion.enabled == 1) {
  if (earthOcclusion_visibility < 0.0) discard;
  color.a *= clamp(earthOcclusion_visibility, 0.0, 1.0);
}
`,
};

export interface EarthOcclusionExtensionProps {
  /** Master switch. Default: true. */
  earthOcclusionEnabled?: boolean;
  /** Soft fade band width across the horizon, in cosine space. */
  earthOcclusionFadeBand?: number;
}

interface EarthOcclusionUniforms {
  cameraDir: [number, number, number];
  cosHorizon: number;
  fadeBand: number;
  altitudeBoost: number;
  enabled: number;
}

interface ViewportLike {
  longitude?: number;
  latitude?: number;
  zoom?: number;
  /** deck.gl GlobeViewport exposes the camera position in common-space
   *  units. For globe view, magnitude / radiusInUnits gives the camera
   *  distance from Earth's center in Earth radii. */
  cameraPosition?: readonly [number, number, number];
  /** [x, y, z] units per meter; for globe, all three are equal and
   *  multiplying by EARTH_RADIUS_M gives Earth's radius in common-space
   *  units (typically 256). */
  distanceScales?: { unitsPerMeter?: readonly [number, number, number] };
}

interface DrawParams {
  context: { viewport?: ViewportLike };
}

const defaultProps = {
  earthOcclusionEnabled: true,
  earthOcclusionFadeBand: { type: "number", value: 0.04, min: 0.001 },
};

// Camera distance in Earth radii. Prefer reading the live camera
// position straight off the deck.gl viewport — that's the only number
// that's guaranteed to match MapLibre's actual perspective camera.
// The closed-form `cameraDistanceFromZoom` fallback (used when the
// viewport doesn't expose cameraPosition / distanceScales — shouldn't
// happen with deck.gl 9 GlobeViewport, but keep it conservative) is
// pinned to the safe upper bound so the shader UNDER-clips rather than
// over-clips at the rim. The previous closed-form (1 + 1.5 * 2^-z*0.7)
// was tuned for an old viewport assumption and underestimated the real
// distance by roughly 3× at zoom 1.6, which clipped a 25° band of
// routes off the visible rim — see commit message for derivation.
export function cameraDistanceFromViewport(viewport: ViewportLike | undefined): number {
  const cp = viewport?.cameraPosition;
  const upm = viewport?.distanceScales?.unitsPerMeter;
  if (cp && upm && upm[0] > 0) {
    const radiusInUnits = upm[0] * EARTH_RADIUS_M;
    if (radiusInUnits > 0) {
      const mag = Math.sqrt(cp[0] * cp[0] + cp[1] * cp[1] + cp[2] * cp[2]);
      const dist = mag / radiusInUnits;
      // Guard against degenerate or above-the-surface camera reads.
      if (Number.isFinite(dist) && dist > 1.001) return dist;
    }
  }
  // Fallback: assume the camera is far enough out that the entire
  // visible disk is OK to draw. Better to under-clip than to repeat the
  // old over-clipping bug.
  return 6;
}

export class EarthOcclusionExtension extends LayerExtension {
  static defaultProps = defaultProps;
  static extensionName = "EarthOcclusionExtension";

  getShaders(): { modules: (typeof shaderModule)[]; inject: typeof injection } {
    return { modules: [shaderModule], inject: injection };
  }

  draw(this: Layer<EarthOcclusionExtensionProps>, params: DrawParams): void {
    const props = this.props as Required<EarthOcclusionExtensionProps>;
    const viewport = params?.context?.viewport;
    const lng = (viewport?.longitude ?? 0) * DEG_TO_RAD;
    const lat = (viewport?.latitude ?? 0) * DEG_TO_RAD;
    const dist = Math.max(1.001, cameraDistanceFromViewport(viewport));
    const uniforms: EarthOcclusionUniforms = {
      cameraDir: [Math.cos(lat) * Math.cos(lng), Math.cos(lat) * Math.sin(lng), Math.sin(lat)],
      cosHorizon: 1.0 / dist,
      fadeBand: props.earthOcclusionFadeBand,
      altitudeBoost: 1.0 / EARTH_RADIUS_M,
      enabled: props.earthOcclusionEnabled ? 1 : 0,
    };
    (
      this as unknown as {
        setShaderModuleProps: (props: Record<string, unknown>) => void;
      }
    ).setShaderModuleProps({ earthOcclusion: uniforms });
  }
}
