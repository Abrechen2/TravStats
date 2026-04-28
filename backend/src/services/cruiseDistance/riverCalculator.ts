/**
 * River-cruise distance calculator.
 *
 * Both ports must share the same `river_<name>` region. The river is
 * approximated as an ordered polyline through anchor ports (handcrafted
 * in `backend/data/rivers/`); each port's position along the river is
 * derived by projecting it onto the polyline and taking the cumulative
 * chord distance up to that point.
 *
 * Two anchor formats are supported:
 *   - `km`-tagged anchors (Rhine, Danube, Mississippi, Mekong): the
 *     anchor's authoritative river kilometer is given directly. The
 *     calculator interpolates between known anchors. This is the
 *     industry-standard navigation reference and is most accurate.
 *   - Plain anchors (Rhône, Volga, Nile, Yangtze, ...): cumulative
 *     chord distance along the anchor polyline × per-river
 *     `meanderFactor`. Less accurate but simple and uniform.
 *
 * Limitations (intentional Phase 3 scope):
 *   - Anchors are sparse (5-30 per river); fine bends between anchors
 *     are absorbed by the meander factor, not modelled directly.
 *   - User-added river ports without coordinates near any anchor get
 *     mapped to the nearest anchor — accuracy degrades by the
 *     port-anchor offset.
 *
 * Attribution: anchor coordinates are public-domain city coordinates
 * (Wikipedia / port websites). River-km values for Tier 1 rivers come
 * from the standard German Rheinkilometer / Donaukilometer / US Lower
 * Mississippi mile conventions.
 */

import { promises as fs } from "fs";
import path from "path";
import logger from "../../utils/logger";
import { haversineKm } from "../../shared/geo/haversine";
import type {
  ComputedLeg,
  Confidence,
  DistanceCalculator,
  PortPoint,
} from "./types";

const RIVER_VERSION = "1.0.0";
const ROUTER_VERSION = "1.0.0";

interface AnchorBase {
  name?: string;
  lat: number;
  lon: number;
}
interface AnchorWithKm extends AnchorBase {
  km: number;
}
type Anchor = AnchorBase | AnchorWithKm;

interface RiverData {
  region: string;
  name: string;
  meanderFactor?: number;
  anchors: Anchor[];
}

interface PreparedRiver {
  region: string;
  name: string;
  meanderFactor: number;
  anchors: Anchor[];
  /** Cumulative chord-km from anchors[0] to anchors[i] (no meander factor). */
  cumulativeChordKm: number[];
  /** Whether all anchors carry an explicit `km` field. */
  hasKm: boolean;
}

let riversPromise: Promise<Map<string, PreparedRiver>> | null = null;

async function loadRivers(): Promise<Map<string, PreparedRiver>> {
  if (riversPromise === null) {
    riversPromise = (async (): Promise<Map<string, PreparedRiver>> => {
      const dir = path.resolve(__dirname, "../../../data/rivers");
      const result = new Map<string, PreparedRiver>();
      try {
        const entries = await fs.readdir(dir);
        for (const file of entries) {
          if (!file.endsWith(".json")) continue;
          const raw = await fs.readFile(path.join(dir, file), "utf8");
          const data = JSON.parse(raw) as RiverData;
          if (!Array.isArray(data.anchors) || data.anchors.length < 2) continue;
          const cumulative: number[] = [0];
          for (let i = 1; i < data.anchors.length; i++) {
            const prev = data.anchors[i - 1];
            const cur = data.anchors[i];
            cumulative.push(
              cumulative[i - 1] +
                haversineKm({ lat: prev.lat, lon: prev.lon }, { lat: cur.lat, lon: cur.lon }),
            );
          }
          const hasKm = data.anchors.every(
            (a): a is AnchorWithKm => typeof (a as AnchorWithKm).km === "number",
          );
          result.set(data.region, {
            region: data.region,
            name: data.name,
            meanderFactor: data.meanderFactor ?? 1.0,
            anchors: data.anchors,
            cumulativeChordKm: cumulative,
            hasKm,
          });
        }
      } catch (err) {
        logger.warn({
          operation: "river_calculator_load_failed",
          dir,
          error: err instanceof Error ? err.message : err,
        });
      }
      return result;
    })();
  }
  return riversPromise;
}

interface ProjectionResult {
  /** Cumulative chord-km from anchor[0] to the projection point. */
  cumulativeKm: number;
  /** Authoritative river-km if the river has explicit km anchors. */
  riverKm: number | null;
  /** Distance from query point to the polyline. */
  offsetKm: number;
  /** Index of the segment the projection landed on. */
  segmentIndex: number;
  /** Fraction along the segment (0-1). */
  segmentT: number;
}

function projectOntoRiver(
  port: PortPoint,
  river: PreparedRiver,
): ProjectionResult {
  let bestSeg = 0;
  let bestT = 0;
  let bestOffset = Infinity;
  for (let i = 0; i < river.anchors.length - 1; i++) {
    const a = river.anchors[i];
    const b = river.anchors[i + 1];
    // Local ENU-ish projection: treat lat/lon as planar at this scale.
    // For river-cruise distances (<3000 km) this is accurate enough.
    const dx = b.lon - a.lon;
    const dy = b.lat - a.lat;
    const segLenSq = dx * dx + dy * dy;
    let t = 0;
    if (segLenSq > 0) {
      t = ((port.lon - a.lon) * dx + (port.lat - a.lat) * dy) / segLenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const projLon = a.lon + t * dx;
    const projLat = a.lat + t * dy;
    const offset = haversineKm(
      { lat: port.lat, lon: port.lon },
      { lat: projLat, lon: projLon },
    );
    if (offset < bestOffset) {
      bestOffset = offset;
      bestSeg = i;
      bestT = t;
    }
  }

  const segStart = river.cumulativeChordKm[bestSeg];
  const segEnd = river.cumulativeChordKm[bestSeg + 1];
  const cumulativeKm = segStart + bestT * (segEnd - segStart);

  let riverKm: number | null = null;
  if (river.hasKm) {
    const a = river.anchors[bestSeg] as AnchorWithKm;
    const b = river.anchors[bestSeg + 1] as AnchorWithKm;
    riverKm = a.km + bestT * (b.km - a.km);
  }

  return {
    cumulativeKm,
    riverKm,
    offsetKm: bestOffset,
    segmentIndex: bestSeg,
    segmentT: bestT,
  };
}

/** Above this offset (km) from the river polyline → reject (port not on river). */
const RIVER_OFFSET_REJECT_KM = 25;

function classifyConfidence(
  fromOffsetKm: number,
  toOffsetKm: number,
  hasKm: boolean,
): Confidence {
  const worstOffset = Math.max(fromOffsetKm, toOffsetKm);
  if (hasKm && worstOffset < 5) return "high";
  if (worstOffset < 5) return "medium"; // chord-based, no authoritative km
  if (worstOffset < 15) return "medium";
  return "low";
}

export const riverCalculator: DistanceCalculator = {
  method: "river-osm",
  routerVersion: ROUTER_VERSION,

  accepts(from: PortPoint, to: PortPoint): boolean {
    if (!from.region || !to.region) return false;
    if (!from.region.startsWith("river_")) return false;
    if (from.region !== to.region) return false;
    return true;
  },

  async compute(from: PortPoint, to: PortPoint): Promise<ComputedLeg | null> {
    const rivers = await loadRivers();
    const river = rivers.get(from.region!);
    if (!river) return null;

    const fromProj = projectOntoRiver(from, river);
    const toProj = projectOntoRiver(to, river);

    if (
      fromProj.offsetKm > RIVER_OFFSET_REJECT_KM ||
      toProj.offsetKm > RIVER_OFFSET_REJECT_KM
    ) {
      return null;
    }

    let distanceKm: number;
    if (river.hasKm && fromProj.riverKm !== null && toProj.riverKm !== null) {
      distanceKm = Math.abs(fromProj.riverKm - toProj.riverKm);
    } else {
      const chordDelta = Math.abs(fromProj.cumulativeKm - toProj.cumulativeKm);
      distanceKm = chordDelta * river.meanderFactor;
    }

    const notes =
      fromProj.offsetKm > 5 || toProj.offsetKm > 5
        ? `offset from=${fromProj.offsetKm.toFixed(1)}km to=${toProj.offsetKm.toFixed(1)}km`
        : null;

    return {
      distanceKm,
      method: "river-osm",
      routerVersion: ROUTER_VERSION,
      dataVersion: `${RIVER_VERSION}:${river.region}`,
      confidence: classifyConfidence(
        fromProj.offsetKm,
        toProj.offsetKm,
        river.hasKm,
      ),
      notes,
    };
  },
};

/** Test helper. */
export function __resetRiverCache(): void {
  riversPromise = null;
}
