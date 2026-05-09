/**
 * specialFlightsLayer
 *
 * Renders "Sonder-Flug" (non-scheduled) flights on the deck.gl map with
 * shapes that reflect each specialType, so a rundown / eclipse chase /
 * ZeroG parabola doesn't look like a regular airline arc.
 *
 * Rendering strategy (pragmatic, not geodesically accurate):
 *
 *   - sightseeing       — circular ring around departureAirport
 *                         (~40 km radius), no arc.
 *   - zerog             — smaller ring (~15 km) with a vertical column,
 *                         signals "loopy flight at altitude".
 *   - eclipse           — straight arc from departure to event coords +
 *                         a marker (ScatterplotLayer) at the event.
 *   - rocket_launch     — high-altitude vertical arc (source = target =
 *                         launch airport, big getHeight).
 *   - aurora / training
 *     ferry / test      — standard arc between dep + arr, distinct
 *                         colour per type (no special shape).
 *
 * The colour palette lives in SPECIAL_TYPE_META so the badge / filter /
 * legend all use the same hues.
 *
 * Implementation notes:
 *   - Inputs are `Flight[]` and not `GeoJSONFeature[]` because the
 *     backend GeoJSON endpoint does not yet carry specialType / event
 *     coords. This keeps backend changes to zero for Phase 3.
 *   - The builder is split into tiny pure helpers so the layer tests
 *     can assert on shape without touching deck.gl internals.
 */
import { ArcLayer, PolygonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Flight } from "../../types";
import { SPECIAL_TYPE_META, type SpecialType } from "../specialFlights/specialTypeMeta";

/** Approximate km-per-degree-longitude at the equator. Good enough
 *  for cosmetic loops on a map, not for geodesy. */
const KM_PER_DEG = 111.32;

const CIRCLE_SEGMENTS = 48;

export interface SpecialArcDatum {
  flightId: string;
  specialType: SpecialType;
  source: [number, number];
  target: [number, number];
  color: [number, number, number, number];
  /** getHeight multiplier; ArcLayer uses this to bow the arc up. */
  height: number;
}

export interface SpecialMarkerDatum {
  flightId: string;
  specialType: SpecialType;
  position: [number, number];
  color: [number, number, number, number];
  radiusKm: number;
}

export interface SpecialLoopDatum {
  flightId: string;
  specialType: SpecialType;
  center: [number, number];
  radiusKm: number;
  color: [number, number, number, number];
  polygon: Array<[number, number]>;
}

export interface SpecialLayerData {
  arcs: SpecialArcDatum[];
  markers: SpecialMarkerDatum[];
  loops: SpecialLoopDatum[];
}

/** Build a closed polygon ring around `center` of the given km radius. */
export function buildRing(
  center: [number, number],
  radiusKm: number,
  segments: number = CIRCLE_SEGMENTS
): Array<[number, number]> {
  const [lon, lat] = center;
  const latRad = (lat * Math.PI) / 180;
  const latKm = KM_PER_DEG;
  const lonKm = KM_PER_DEG * Math.max(Math.cos(latRad), 1e-6);

  const points: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const dLon = (Math.cos(theta) * radiusKm) / lonKm;
    const dLat = (Math.sin(theta) * radiusKm) / latKm;
    points.push([lon + dLon, lat + dLat]);
  }
  return points;
}

/** Pull the RGB colour for a specialType and turn it into a deck.gl
 *  RGBA tuple. */
function rgba(type: SpecialType, alpha = 220): [number, number, number, number] {
  const meta = SPECIAL_TYPE_META[type];
  return [meta.rgb[0], meta.rgb[1], meta.rgb[2], alpha];
}

function isSpecialType(t: string | null | undefined): t is SpecialType {
  return (
    t === "sightseeing" ||
    t === "eclipse" ||
    t === "rocket_launch" ||
    t === "zerog" ||
    t === "aurora" ||
    t === "training" ||
    t === "ferry" ||
    t === "test"
  );
}

/**
 * Split a list of Flights into the three deck.gl-friendly buckets
 * (arcs / markers / loops). Pure function — the tests exercise this.
 */
export function buildSpecialFlightData(flights: Flight[]): SpecialLayerData {
  const arcs: SpecialArcDatum[] = [];
  const markers: SpecialMarkerDatum[] = [];
  const loops: SpecialLoopDatum[] = [];

  for (const f of flights) {
    if (!isSpecialType(f.specialType)) continue;
    const dep: [number, number] = [f.depLon, f.depLat];

    if (f.specialType === "sightseeing") {
      const center: [number, number] = dep;
      loops.push({
        flightId: f.id,
        specialType: "sightseeing",
        center,
        radiusKm: 40,
        color: rgba("sightseeing", 180),
        polygon: buildRing(center, 40),
      });
      continue;
    }

    if (f.specialType === "zerog") {
      const center: [number, number] =
        f.patternLat != null && f.patternLon != null ? [f.patternLon, f.patternLat] : dep;
      loops.push({
        flightId: f.id,
        specialType: "zerog",
        center,
        radiusKm: 15,
        color: rgba("zerog", 200),
        polygon: buildRing(center, 15),
      });
      // An additional small vertical arc to indicate the altitude
      // component — helps distinguish zerog from sightseeing on the map.
      arcs.push({
        flightId: f.id,
        specialType: "zerog",
        source: center,
        target: center,
        color: rgba("zerog", 220),
        height: 4,
      });
      continue;
    }

    if (f.specialType === "eclipse") {
      const eventPos: [number, number] | null =
        f.eventLat != null && f.eventLon != null ? [f.eventLon, f.eventLat] : null;
      if (eventPos) {
        arcs.push({
          flightId: f.id,
          specialType: "eclipse",
          source: dep,
          target: eventPos,
          color: rgba("eclipse", 220),
          height: 0.6,
        });
        markers.push({
          flightId: f.id,
          specialType: "eclipse",
          position: eventPos,
          color: rgba("eclipse", 240),
          radiusKm: 50,
        });
      } else {
        // Fallback — no event coords, just render as a standard arc.
        arcs.push({
          flightId: f.id,
          specialType: "eclipse",
          source: dep,
          target: [f.arrLon, f.arrLat],
          color: rgba("eclipse", 220),
          height: 0.3,
        });
      }
      continue;
    }

    if (f.specialType === "rocket_launch") {
      // Vertical "column" at the launch site — source = target gives a
      // tight loop-de-loop that deck.gl draws almost straight up.
      arcs.push({
        flightId: f.id,
        specialType: "rocket_launch",
        source: dep,
        target: dep,
        color: rgba("rocket_launch", 240),
        height: 6,
      });
      markers.push({
        flightId: f.id,
        specialType: "rocket_launch",
        position: dep,
        color: rgba("rocket_launch", 220),
        radiusKm: 25,
      });
      continue;
    }

    // aurora / training / ferry / test — standard arc with a
    // distinct colour. If departure == arrival the arc collapses into
    // a stub; for these types the user usually has two airports.
    arcs.push({
      flightId: f.id,
      specialType: f.specialType,
      source: dep,
      target: [f.arrLon, f.arrLat],
      color: rgba(f.specialType, 220),
      height: f.specialType === "aurora" ? 0.8 : 0.4,
    });
  }

  return { arcs, markers, loops };
}

/** Layer IDs — exposed for tests and MapContainer legend keying. */
export const SPECIAL_LAYER_IDS = {
  arc: "special-flights-arc",
  marker: "special-flights-marker",
  loop: "special-flights-loop",
} as const;

/**
 * Build the deck.gl layer triplet. Returns `[]` when there are no
 * special flights so the caller can spread-concat without extra
 * conditionals.
 */
export function createSpecialFlightsLayers(
  flights: Flight[],
  onFlightClick?: (flightId: string) => void
): Layer[] {
  const { arcs, markers, loops } = buildSpecialFlightData(flights);
  if (arcs.length === 0 && markers.length === 0 && loops.length === 0) return [];

  const layers: Layer[] = [];

  if (loops.length > 0) {
    layers.push(
      new PolygonLayer<SpecialLoopDatum>({
        id: SPECIAL_LAYER_IDS.loop,
        data: loops,
        getPolygon: (d) => d.polygon,
        getFillColor: (d) => [d.color[0], d.color[1], d.color[2], 40],
        getLineColor: (d) => d.color,
        lineWidthMinPixels: 2,
        filled: true,
        stroked: true,
        pickable: !!onFlightClick,
        onClick: onFlightClick
          ? ({ object }): void => {
              if (object?.flightId) onFlightClick(object.flightId);
            }
          : undefined,
      })
    );
  }

  if (arcs.length > 0) {
    layers.push(
      new ArcLayer<SpecialArcDatum>({
        id: SPECIAL_LAYER_IDS.arc,
        data: arcs,
        getSourcePosition: (d) => d.source,
        getTargetPosition: (d) => d.target,
        getSourceColor: (d) => d.color,
        getTargetColor: (d) => d.color,
        getHeight: (d) => d.height,
        getWidth: () => 2.5,
        widthMinPixels: 1.5,
        pickable: !!onFlightClick,
        onClick: onFlightClick
          ? ({ object }): void => {
              if (object?.flightId) onFlightClick(object.flightId);
            }
          : undefined,
      })
    );
  }

  if (markers.length > 0) {
    layers.push(
      new ScatterplotLayer<SpecialMarkerDatum>({
        id: SPECIAL_LAYER_IDS.marker,
        data: markers,
        getPosition: (d) => d.position,
        // radiusKm — ScatterplotLayer expects metres
        getRadius: (d) => d.radiusKm * 1000,
        radiusMinPixels: 4,
        radiusMaxPixels: 30,
        getFillColor: (d) => [d.color[0], d.color[1], d.color[2], 140],
        getLineColor: (d) => d.color,
        stroked: true,
        lineWidthMinPixels: 2,
        pickable: !!onFlightClick,
        onClick: onFlightClick
          ? ({ object }): void => {
              if (object?.flightId) onFlightClick(object.flightId);
            }
          : undefined,
      })
    );
  }

  return layers;
}
