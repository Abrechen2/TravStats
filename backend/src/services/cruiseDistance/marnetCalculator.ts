/**
 * Marnet (Eurostat-derived shipping-lane network) distance calculator.
 *
 * Wraps `searoute-ts`, whose vendored `marnet` graph traces back to the
 * Eurostat SeaRoute project (originally Oak Ridge National Labs Global
 * Shipping Lane Network 2000, AIS-enriched). Returns the routed
 * polyline length plus the haversine snap-distances at each end —
 * dramatically more accurate than great-circle for ocean legs because
 * it follows actual shipping lanes through canals, straits, and around
 * landmasses.
 *
 * Limitations (Phase 2 scope):
 *   - Inland river legs (region='river') are rejected → fall through
 *     to the river calculator (Phase 3) or haversine.
 *   - Ports >200 km from any marnet node fall back to haversine, since
 *     the snap distances would dominate and confuse the metric.
 *
 * License notes:
 *   - searoute-ts is MIT (Mayur Rawte 2022).
 *   - Underlying network derives from Eurostat SeaRoute (EUPL-1.2) +
 *     ORNL Global Shipping Lane Network (US-Government → public domain).
 *   - We attribute "Sea-route distances based on Eurostat SeaRoute"
 *     in the application (see LICENSES.md / About page).
 */

import logger from "../../utils/logger";
import { haversineKm, polylineLengthKm } from "../../shared/geo/haversine";
import type {
  ComputedLeg,
  Confidence,
  DistanceCalculator,
  PortPoint,
} from "./types";

interface SeaRouteFeature {
  geometry: { coordinates: number[][] };
}
type SeaRouteFn = (
  origin: unknown,
  destination: unknown,
  units?: "kilometers",
) => SeaRouteFeature;

let seaRoutePromise: Promise<SeaRouteFn | null> | null = null;

async function loadSeaRoute(): Promise<SeaRouteFn | null> {
  // Skip during unit tests — the marnet graph is ~3600 features and
  // path-finder pre-builds an adjacency map at module load. Tests
  // covering this calculator must mock seaRoute() directly.
  if (process.env.NODE_ENV === "test") return null;

  if (seaRoutePromise === null) {
    seaRoutePromise = (async (): Promise<SeaRouteFn | null> => {
      try {
        const dynamicImport = new Function(
          "specifier",
          "return import(specifier)",
        ) as (specifier: string) => Promise<{
          seaRoute?: SeaRouteFn;
          default?: { seaRoute?: SeaRouteFn };
          "module.exports"?: { seaRoute?: SeaRouteFn };
        }>;
        const mod = await dynamicImport("searoute-ts");
        return (
          mod.seaRoute ??
          mod.default?.seaRoute ??
          mod["module.exports"]?.seaRoute ??
          null
        );
      } catch (err) {
        logger.warn({
          operation: "marnet_calculator_load_failed",
          error: err instanceof Error ? err.message : err,
        });
        return null;
      }
    })();
  }
  return seaRoutePromise;
}

/** Below this snap distance (km) → high confidence. */
const SNAP_HIGH_CONFIDENCE_KM = 25;
/** Above this snap distance (km) → reject and fall through. */
const SNAP_REJECT_KM = 200;

/**
 * Marnet only wins when it provides clear evidence of a non-chord
 * routing (e.g. canal transit, around-landmass detour). If the routed
 * polyline is within this ratio of the haversine chord, it's
 * essentially open-ocean direct — and marnet's snap-distance noise
 * makes it less accurate than the chord itself. Caller treats this
 * as "decline" and the orchestrator falls through to haversine.
 *
 * Threshold tuned against scripts/smoke-marnet-distances.ts (Phase 4):
 *   Hamburg → New York         ratio 1.06 → fall back, haversine -1.1%
 *   Civitavecchia → Barcelona  ratio 1.03 → fall back, haversine -6.6%
 *   Singapore → Hong Kong      ratio 1.08 → fall back, haversine -0.3%
 *   Sydney → Auckland          ratio 1.14 → fall back, haversine +0.3%
 *   Miami → Cozumel            ratio 1.14 → fall back, haversine +7.7%
 *   Hamburg → Cape Town        ratio 1.25 → marnet wins,  +2.9%
 *   Hamburg → Tokyo (Suez)     ratio 2.41 → marnet wins,  +3.1%
 *   Buenos Aires → Valparaíso  ratio 4.58 → marnet wins (capped), +2.8%
 *
 * Lifted from 1.10 to 1.15 in Phase 4: the SYD→AKL and MIA→CZM cases
 * showed marnet's sparse-graph zigzag was 14% above chord on legs that
 * are visibly open-ocean direct — haversine wins those.
 */
const MARNET_DETOUR_THRESHOLD = 1.15;

/**
 * Hard upper bound on plausible cruise routings. Buenos Aires →
 * Valparaíso via Magellan/Drake is ~3.4× the chord; circumnavigations
 * are out of scope. Above this ratio the marnet graph is almost
 * certainly zigzagging through sparse southern-hemisphere nodes —
 * cap the distance at chord × this factor and mark low confidence.
 *
 * Lowered from 4.0 to 3.5 in Phase 4 after BUE→VLP overshot at
 * ratio 4.58 with reference 4200 km. chord×3.5 = 4319 km, +2.8%.
 */
const MARNET_OVERSHOOT_CAP = 3.5;

const MARNET_VERSION = "1.0.0";
const ROUTER_VERSION = "1.0.0";

function classifyConfidence(
  fromSnapKm: number,
  toSnapKm: number,
): Confidence {
  const worst = Math.max(fromSnapKm, toSnapKm);
  if (worst <= SNAP_HIGH_CONFIDENCE_KM) return "high";
  if (worst <= 80) return "medium";
  return "low";
}

function isInlandPort(port: PortPoint): boolean {
  // The Port.region taxonomy tags rivers as `river_<name>` (e.g.
  // `river_rhine`, `river_danube`). River ports get routed by the
  // riverCalculator instead.
  return port.region?.startsWith("river_") === true;
}

async function computeMarnetDistance(
  from: PortPoint,
  to: PortPoint,
  seaRoute: SeaRouteFn,
): Promise<ComputedLeg | null> {
  // searoute-ts wants [lon, lat] points. It internally calls
  // snapToNetwork() → returns a routed Feature<LineString>.
  const origin = { type: "Point", coordinates: [from.lon, from.lat] };
  const destination = { type: "Point", coordinates: [to.lon, to.lat] };

  let feature: SeaRouteFeature;
  try {
    feature = seaRoute(origin, destination, "kilometers");
  } catch (err) {
    logger.warn({
      operation: "marnet_calculator_route_failed",
      from: from.id,
      to: to.id,
      error: err instanceof Error ? err.message : err,
    });
    return null;
  }

  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;

  // searoute-ts already snaps both endpoints to the network. The
  // returned LineString starts at the snapped origin, ends at the
  // snapped destination. We add the haversine "last-mile" hops back
  // (port → snapped origin, snapped destination → port) so the total
  // is comparable to point-to-point measurements.
  const firstCoord = coords[0];
  const lastCoord = coords[coords.length - 1];
  const fromSnapKm = haversineKm(
    { lat: from.lat, lon: from.lon },
    { lat: firstCoord[1], lon: firstCoord[0] },
  );
  const toSnapKm = haversineKm(
    { lat: to.lat, lon: to.lon },
    { lat: lastCoord[1], lon: lastCoord[0] },
  );

  if (fromSnapKm > SNAP_REJECT_KM || toSnapKm > SNAP_REJECT_KM) {
    return null;
  }

  const polylineKm = polylineLengthKm(
    coords.map(([lon, lat]) => ({ lat, lon })),
  );
  const routedKm = polylineKm + fromSnapKm + toSnapKm;
  const chordKm = haversineKm(
    { lat: from.lat, lon: from.lon },
    { lat: to.lat, lon: to.lon },
  );
  const ratio = routedKm / Math.max(chordKm, 1);

  // Open-ocean direct routes: marnet adds snap noise without insight.
  // Decline so the orchestrator falls through to haversine.
  if (ratio < MARNET_DETOUR_THRESHOLD) return null;

  // Sparse-graph zigzag: cap and mark low confidence.
  if (ratio > MARNET_OVERSHOOT_CAP) {
    return {
      distanceKm: chordKm * MARNET_OVERSHOOT_CAP,
      method: "eurostat",
      routerVersion: ROUTER_VERSION,
      dataVersion: MARNET_VERSION,
      confidence: "low",
      notes: `ratio=${ratio.toFixed(2)} capped at ×${MARNET_OVERSHOOT_CAP}`,
    };
  }

  return {
    distanceKm: routedKm,
    method: "eurostat",
    routerVersion: ROUTER_VERSION,
    dataVersion: MARNET_VERSION,
    confidence: classifyConfidence(fromSnapKm, toSnapKm),
    notes:
      fromSnapKm > SNAP_HIGH_CONFIDENCE_KM || toSnapKm > SNAP_HIGH_CONFIDENCE_KM
        ? `snap from=${fromSnapKm.toFixed(1)}km to=${toSnapKm.toFixed(1)}km`
        : null,
  };
}

export const marnetCalculator: DistanceCalculator = {
  method: "eurostat",
  routerVersion: ROUTER_VERSION,

  accepts(from: PortPoint, to: PortPoint): boolean {
    if (isInlandPort(from) || isInlandPort(to)) return false;
    if (process.env.NODE_ENV === "test") return false;
    return true;
  },

  async compute(from: PortPoint, to: PortPoint): Promise<ComputedLeg | null> {
    const seaRoute = await loadSeaRoute();
    if (!seaRoute) {
      // Test mode (or load failed) — accept() should have already
      // declined, but if we got here, fall through.
      return null;
    }
    return computeMarnetDistance(from, to, seaRoute);
  },
};

/** Test helper — resets the lazy-loaded seaRoute promise. */
export function __resetMarnetCache(): void {
  seaRoutePromise = null;
}
