import * as THREE from "three";

/**
 * Custom Earth shader for the 3D globe — day texture lit by the sun,
 * night texture for the dark side, soft terminator with warm dawn/dusk
 * glow. Bumpmap modulates the day texture as a subtle elevation hint.
 *
 * The sunDirection uniform is updated from the React side on a tick loop
 * so the terminator visibly drifts across the planet. Pass into the
 * react-globe.gl `globeMaterial` prop.
 */
export interface DayNightMaterialOptions {
  dayTextureUrl: string;
  nightTextureUrl: string;
  bumpTextureUrl?: string;
}

export interface DayNightMaterial extends THREE.ShaderMaterial {
  setSunDirection(direction: THREE.Vector3): void;
}

const VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldNormal;
varying vec2 vUv;

void main() {
  // World-space normal so the sun direction (also world-space) lights
  // the planet consistently no matter where the camera is.
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D dayTexture;
uniform sampler2D nightTexture;
uniform sampler2D bumpTexture;
uniform vec3 sunDirection;
uniform float useBump;

varying vec3 vWorldNormal;
varying vec2 vUv;

void main() {
  vec3 dayColor = texture2D(dayTexture, vUv).rgb;
  vec3 nightColor = texture2D(nightTexture, vUv).rgb;

  // Lambert against the sun direction. Both vectors are in world space.
  float lambert = dot(normalize(vWorldNormal), normalize(sunDirection));

  // Soft transition zone around the terminator (~0.3 of the dot range)
  // so day -> night isn't a sharp line. The smoothstep range was tuned
  // to give a roughly 60-70 km wide twilight band on a 12,742 km Earth.
  float dayFactor = smoothstep(-0.18, 0.18, lambert);

  vec3 color = mix(nightColor, dayColor, dayFactor);

  // Bumpmap as a tiny albedo dimming (cheaper than real normal-mapping
  // and visually it just adds a hint of relief on continents).
  if (useBump > 0.5) {
    float bump = texture2D(bumpTexture, vUv).r;
    color *= mix(1.0, 0.6 + 0.4 * bump, dayFactor);
  }

  // Warm rim along the terminator — the orange-pink dawn/dusk line that
  // makes night-side photos of Earth from space look so good. Falls off
  // sharply outside ±0.18 lambert so it only appears in the twilight band.
  float terminatorBand = 1.0 - smoothstep(0.0, 0.18, abs(lambert));
  color += vec3(0.35, 0.18, 0.08) * terminatorBand * 0.55;

  gl_FragColor = vec4(color, 1.0);
}
`;

export function createDayNightGlobeMaterial(options: DayNightMaterialOptions): DayNightMaterial {
  const loader = new THREE.TextureLoader();
  // colorSpace=SRGB on the day/night maps so they display with correct
  // gamma; the bump map stays in linear space (it's a height field).
  const dayTexture = loader.load(options.dayTextureUrl);
  dayTexture.colorSpace = THREE.SRGBColorSpace;
  const nightTexture = loader.load(options.nightTextureUrl);
  nightTexture.colorSpace = THREE.SRGBColorSpace;
  const bumpTexture = options.bumpTextureUrl
    ? loader.load(options.bumpTextureUrl)
    : new THREE.Texture();

  const material = new THREE.ShaderMaterial({
    uniforms: {
      dayTexture: { value: dayTexture },
      nightTexture: { value: nightTexture },
      bumpTexture: { value: bumpTexture },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      useBump: { value: options.bumpTextureUrl ? 1.0 : 0.0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  }) as DayNightMaterial;

  material.setSunDirection = (direction: THREE.Vector3): void => {
    const vec = material.uniforms.sunDirection.value as THREE.Vector3;
    vec.copy(direction);
  };

  return material;
}

/**
 * Compute a sun direction vector from the current real-world UTC time.
 * Approximation: ignores axial tilt (no seasonal day-length variation)
 * so the terminator runs roughly north-south. Good enough for the
 * "where is it day right now" visual effect; not for navigation.
 *
 * The X-Z plane is the equator; Y is the rotation axis. The angle ramps
 * from 0 at noon UTC (sun overhead at lon 0) and rotates through the
 * day so the dark side of the planet is always opposite the sun.
 */
export function computeSunDirection(
  date: Date = new Date(),
  speedMultiplier: number = 1
): THREE.Vector3 {
  // Hours since midnight UTC, sped up if requested. speedMultiplier=1
  // means real time (24 h per rotation); higher values let users see
  // the terminator visibly drift in seconds rather than hours.
  const utcSeconds =
    date.getUTCHours() * 3600 +
    date.getUTCMinutes() * 60 +
    date.getUTCSeconds() +
    date.getUTCMilliseconds() / 1000;
  const dayFraction = ((utcSeconds * speedMultiplier) / 86400) % 1;
  // At noon UTC (12:00) sun is overhead at longitude 0. Three.js convention
  // for an equirectangular Earth texture has lon=0 facing -Z by default.
  const angle = (dayFraction - 0.5) * Math.PI * 2;
  return new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle));
}
