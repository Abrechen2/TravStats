/**
 * Eurostat marnet shipping-lane graph + A* pathfinder.
 *
 * Replaces the abandoned `searoute-ts` npm package, whose ESM loader
 * silently broke on Node ≥ 22 (`Cannot find module ./lib/utils` due to
 * extensionless internal imports). The marnet GeoJSON itself is
 * vendored verbatim from the same source — searoute-ts's own data file
 * — so behaviour is identical to a working searoute-ts call. We just
 * own the loader + pathfinder.
 *
 * Data source:
 *   `backend/data/marnet/marnet.geojson` — 3 599 LineString features,
 *   11 245 vertices total. Originally from the eurostat/searoute Java
 *   project (EUPL-1.2) plus the ORNL Global Shipping Lane Network
 *   (US-Government → public domain). Attribution preserved in
 *   `LICENSES.md`.
 *
 * Graph shape:
 *   Vertices on the 0.0001° grid (~11 m at the equator) are merged into
 *   one node — this turns ~11 k coordinate vertices into ~6 k unique
 *   nodes and ~7.6 k undirected edges, where every node is exactly the
 *   endpoint of one or more LineString segments. The graph is small
 *   enough that A* visits at most a few thousand nodes per query.
 *
 * Connectivity:
 *   124 connected components. The largest (the "global ocean" — open
 *   sea + connected major canals) covers 93 % of nodes; the remaining
 *   123 are tiny isolated bodies of water (Caspian, Aral, Great Lakes,
 *   landlocked harbours). Snap-to-nearest defaults to the main
 *   component so a misplaced port can never silently route into Lake
 *   Baikal.
 */

import * as fs from "fs";
import * as path from "path";
import logger from "../../utils/logger";
import { bearingDeg, bearingDeviation, haversineKm } from "../../shared/geo/haversine";
import { BinaryHeap } from "../../shared/geo/binaryHeap";

/** Default location of the vendored GeoJSON. Resolved relative to this
 * file so dev (`src/services/marnet/`) and prod (`dist/services/marnet/`)
 * both land at `<backend>/data/marnet/marnet.geojson`. */
const DEFAULT_DATA_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "data",
  "marnet",
  "marnet.geojson",
);

/** Coordinate-rounding precision for node-key dedup. 4 decimals ≈ 11 m
 * at the equator — generous enough that float-roundtrip noise can't
 * separate intended-to-be-equal endpoints, tight enough that
 * intentionally-distinct nearby vertices stay distinct. */
const KEY_PRECISION = 4;

/** Spatial-index bucket size, in degrees. 10° gives 36 × 18 = 648
 * buckets covering the whole globe; with ~6 k nodes that's ~10 nodes
 * per bucket on average. Snap-to-nearest looks at the centre bucket
 * plus its neighbours, which is fast enough that a per-query KD-tree
 * is unnecessary. */
const BUCKET_DEG = 10;

/** Maximum number of A* node expansions before giving up. With
 * a 6 k-node graph this is roughly 8× the entire graph — safety net
 * against pathological inputs, never tripped on real cruise legs. */
const A_STAR_NODE_BUDGET = 50_000;

interface MarnetFeature {
  readonly type: "Feature";
  readonly properties: Record<string, unknown>;
  readonly geometry: { readonly type: "LineString"; readonly coordinates: readonly number[][] };
}

interface MarnetGeoJSON {
  readonly type: "FeatureCollection";
  readonly features: ReadonlyArray<MarnetFeature>;
}

interface Edge {
  readonly neighborKey: string;
  readonly lengthKm: number;
}

export interface MarnetNode {
  readonly key: string;
  readonly lon: number;
  readonly lat: number;
  readonly edges: ReadonlyArray<Edge>;
  /** Connected-component id assigned during graph build; nodes in
   * different components are unreachable from each other. */
  readonly componentId: number;
}

interface MutableNode {
  key: string;
  lon: number;
  lat: number;
  edges: Edge[];
  componentId: number;
}

interface SpatialBucket {
  readonly keys: string[];
}

export interface MarnetGraph {
  readonly nodes: ReadonlyMap<string, MarnetNode>;
  readonly buckets: ReadonlyMap<string, SpatialBucket>;
  /** Component id with the highest node count — the "global ocean".
   * Used by `findNearestNode({ onlyMainComponent: true })` to filter
   * out tiny isolated water bodies that no cruise port belongs to. */
  readonly largestComponentId: number;
  readonly componentSizes: ReadonlyMap<number, number>;
}

let graphPromise: Promise<MarnetGraph> | null = null;
let testGraph: MarnetGraph | null = null;

/** Stable string key for a coordinate pair, rounded to KEY_PRECISION
 * decimals so floating-point round-trips don't accidentally fragment
 * what should be the same node. */
export function nodeKey(lon: number, lat: number): string {
  return `${lon.toFixed(KEY_PRECISION)},${lat.toFixed(KEY_PRECISION)}`;
}

/** Spatial-bucket key — identifies the BUCKET_DEG cell containing the
 * coordinate. Bucket origins fall on multiples of BUCKET_DEG. */
function bucketKey(lon: number, lat: number): string {
  const lonBucket = Math.floor(lon / BUCKET_DEG) * BUCKET_DEG;
  const latBucket = Math.floor(lat / BUCKET_DEG) * BUCKET_DEG;
  return `${lonBucket},${latBucket}`;
}

/** Yield bucket keys in expanding rings around (lon, lat). Wraps
 * longitude around the antimeridian (e.g. lon=175 with radius 1
 * yields the lon=-175 bucket too) so a snap near the dateline finds
 * nodes on both sides. Skips buckets whose latitude is out of range
 * (above the poles). */
function* expandingBuckets(
  lon: number,
  lat: number,
  ringRadius: number,
): Generator<string> {
  const cLon = Math.floor(lon / BUCKET_DEG) * BUCKET_DEG;
  const cLat = Math.floor(lat / BUCKET_DEG) * BUCKET_DEG;
  if (ringRadius === 0) {
    yield `${cLon},${cLat}`;
    return;
  }
  for (let dLat = -ringRadius; dLat <= ringRadius; dLat++) {
    for (let dLon = -ringRadius; dLon <= ringRadius; dLon++) {
      // Only emit cells on the ring boundary, not interior.
      if (Math.abs(dLat) !== ringRadius && Math.abs(dLon) !== ringRadius) continue;
      const latB = cLat + dLat * BUCKET_DEG;
      if (latB < -90 || latB >= 90) continue;
      const lonRaw = cLon + dLon * BUCKET_DEG;
      // Wrap longitude into [-180, 180).
      const lonB = ((((lonRaw + 180) % 360) + 360) % 360) - 180;
      yield `${lonB},${latB}`;
    }
  }
}

function buildGraphFromGeoJSON(fc: MarnetGeoJSON): MarnetGraph {
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) {
    throw new Error("Invalid marnet GeoJSON: not a FeatureCollection");
  }

  const nodes = new Map<string, MutableNode>();

  function ensureNode(lon: number, lat: number): MutableNode {
    const key = nodeKey(lon, lat);
    let node = nodes.get(key);
    if (!node) {
      node = { key, lon, lat, edges: [], componentId: -1 };
      nodes.set(key, node);
    }
    return node;
  }

  function addEdge(a: MutableNode, b: MutableNode, lengthKm: number): void {
    if (a.key === b.key) return;
    if (!a.edges.some((e) => e.neighborKey === b.key)) {
      a.edges.push({ neighborKey: b.key, lengthKm });
    }
    if (!b.edges.some((e) => e.neighborKey === a.key)) {
      b.edges.push({ neighborKey: a.key, lengthKm });
    }
  }

  for (const feature of fc.features) {
    if (feature.geometry.type !== "LineString") continue;
    const coords = feature.geometry.coordinates;
    if (coords.length < 2) continue;
    for (let i = 1; i < coords.length; i++) {
      const [lonA, latA] = coords[i - 1];
      const [lonB, latB] = coords[i];
      const a = ensureNode(lonA, latA);
      const b = ensureNode(lonB, latB);
      const lengthKm = haversineKm({ lat: latA, lon: lonA }, { lat: latB, lon: lonB });
      addEdge(a, b, lengthKm);
    }
  }

  // Spatial bucket index.
  const buckets = new Map<string, SpatialBucket>();
  for (const node of nodes.values()) {
    const bk = bucketKey(node.lon, node.lat);
    let bucket = buckets.get(bk);
    if (!bucket) {
      bucket = { keys: [] };
      buckets.set(bk, bucket);
    }
    bucket.keys.push(node.key);
  }

  // Connected-component labelling via iterative BFS.
  const componentSizes = new Map<number, number>();
  let nextComponentId = 0;
  for (const seed of nodes.values()) {
    if (seed.componentId !== -1) continue;
    const queue: MutableNode[] = [seed];
    let size = 0;
    while (queue.length > 0) {
      const cur = queue.pop()!;
      if (cur.componentId !== -1) continue;
      cur.componentId = nextComponentId;
      size++;
      for (const edge of cur.edges) {
        const nb = nodes.get(edge.neighborKey);
        if (nb && nb.componentId === -1) queue.push(nb);
      }
    }
    componentSizes.set(nextComponentId, size);
    nextComponentId++;
  }

  let largestComponentId = 0;
  let largestSize = 0;
  for (const [id, size] of componentSizes) {
    if (size > largestSize) {
      largestSize = size;
      largestComponentId = id;
    }
  }

  let edgeCount = 0;
  for (const node of nodes.values()) edgeCount += node.edges.length;
  edgeCount /= 2; // undirected

  logger.info({
    operation: "marnet_graph_built",
    nodes: nodes.size,
    edges: edgeCount,
    components: componentSizes.size,
    largestComponentSize: largestSize,
    largestComponentPct: Math.round((largestSize / nodes.size) * 100),
  });

  // Freeze for the public type.
  return {
    nodes: nodes as ReadonlyMap<string, MarnetNode>,
    buckets,
    largestComponentId,
    componentSizes,
  };
}

async function buildGraphFromFile(geoPath: string): Promise<MarnetGraph> {
  const buf = await fs.promises.readFile(geoPath, "utf-8");
  const fc = JSON.parse(buf) as MarnetGeoJSON;
  return buildGraphFromGeoJSON(fc);
}

/** Lazy singleton accessor. First call blocks on the GeoJSON read +
 * graph build (~30 ms on a fast disk); subsequent calls resolve
 * immediately. Tests can short-circuit via `setMarnetGraphForTesting`. */
export async function loadMarnetGraph(): Promise<MarnetGraph> {
  if (testGraph !== null) return testGraph;
  if (graphPromise === null) {
    graphPromise = buildGraphFromFile(DEFAULT_DATA_PATH).catch((err) => {
      graphPromise = null;
      throw err;
    });
  }
  return graphPromise;
}

/** Test hook — pass `null` to clear. Bypasses the disk read entirely
 * so unit tests can supply a deterministic synthetic graph. */
export function setMarnetGraphForTesting(graph: MarnetGraph | null): void {
  testGraph = graph;
}

/** Test hook — build a graph from an in-memory FeatureCollection. */
export function buildMarnetGraphForTesting(fc: MarnetGeoJSON): MarnetGraph {
  return buildGraphFromGeoJSON(fc);
}

export interface NearestNodeOptions {
  /** Restrict to the largest connected component. Defaults to true so
   * a port near a tiny isolated lake (Caspian, Aral, …) snaps to the
   * global-ocean component instead of into the lake. */
  readonly onlyMainComponent?: boolean;
  /** How many bucket rings to scan before giving up. 5 rings × 10° =
   * a 110°-wide window — far more than any real port needs. */
  readonly maxRingRadius?: number;
  /** Forward direction in degrees from north (0 = north, 90 = east).
   * When set, candidate nodes whose bearing FROM (lat, lon) deviates
   * more than `forwardToleranceDeg` from this value are de-prioritised:
   * the function still returns the nearest forward-pointing node, and
   * only falls back to the nearest unfiltered node if no forward
   * candidate exists at all. Used to avoid u-turn snaps where the
   * geographically nearest marnet node sits *behind* the direction of
   * travel (e.g. Hamburg-corridor exit snapping back into the Elbe). */
  readonly forwardBearing?: number;
  /** Half-angle of the forward cone in degrees, default 90 (so the
   * accepted cone spans 180°: anything not pointing backwards). */
  readonly forwardToleranceDeg?: number;
}

/** Find the closest graph node to (lat, lon). O(buckets-scanned) — in
 * practice 1-3 ring expansions land enough candidates.
 *
 * When `forwardBearing` is provided, the scan tracks two best candidates
 * in parallel: one constrained to the forward cone, one unconstrained.
 * The forward candidate wins if found; the unconstrained best is the
 * fallback so corridor-exit-with-no-forward-marnet-node still routes. */
export function findNearestNode(
  graph: MarnetGraph,
  lat: number,
  lon: number,
  options: NearestNodeOptions = {},
): { readonly node: MarnetNode; readonly distKm: number } | null {
  const onlyMain = options.onlyMainComponent !== false;
  const maxRing = options.maxRingRadius ?? 5;
  const forwardBearing = options.forwardBearing;
  const forwardTolerance = options.forwardToleranceDeg ?? 90;

  let best: { node: MarnetNode; distKm: number } | null = null;
  let bestForward: { node: MarnetNode; distKm: number } | null = null;
  for (let ring = 0; ring <= maxRing; ring++) {
    let foundInRing = false;
    for (const bk of expandingBuckets(lon, lat, ring)) {
      const bucket = graph.buckets.get(bk);
      if (!bucket) continue;
      for (const k of bucket.keys) {
        const node = graph.nodes.get(k);
        if (!node) continue;
        if (onlyMain && node.componentId !== graph.largestComponentId) continue;
        const distKm = haversineKm({ lat, lon }, { lat: node.lat, lon: node.lon });
        if (best === null || distKm < best.distKm) {
          best = { node, distKm };
        }
        if (forwardBearing !== undefined && distKm > 1e-6) {
          const candidateBearing = bearingDeg({ lat, lon }, { lat: node.lat, lon: node.lon });
          if (bearingDeviation(candidateBearing, forwardBearing) <= forwardTolerance) {
            if (bestForward === null || distKm < bestForward.distKm) {
              bestForward = { node, distKm };
            }
          }
        }
        foundInRing = true;
      }
    }
    // Stop expanding once both tracked bests are stable. With a forward
    // cone the unconstrained best can lock in early but the forward
    // candidate may need another ring; keep scanning until at least the
    // forward best is set, or we hit maxRing.
    if (
      best !== null &&
      foundInRing &&
      ring >= 1 &&
      (forwardBearing === undefined || bestForward !== null)
    ) {
      return bestForward ?? best;
    }
  }
  return bestForward ?? best;
}

export interface MarnetPath {
  /** Polyline of node coordinates, [lon, lat] from start to end
   * inclusive. Each consecutive pair corresponds to one graph edge. */
  readonly coords: ReadonlyArray<readonly [number, number]>;
  /** Sum of edge lengths along the returned path. */
  readonly lengthKm: number;
  /** Number of nodes A* popped — useful for performance assertions. */
  readonly visitedNodes: number;
}

/** A* shortest path between two graph nodes. Heuristic is haversine
 * great-circle distance to the goal, which is consistent (admissible
 * + monotone) for this graph, so the closed-set early-exit is safe. */
export function findMarnetPath(
  graph: MarnetGraph,
  startKey: string,
  endKey: string,
): MarnetPath | null {
  const start = graph.nodes.get(startKey);
  const end = graph.nodes.get(endKey);
  if (!start || !end) return null;
  if (startKey === endKey) {
    return { coords: [[start.lon, start.lat]], lengthKm: 0, visitedNodes: 1 };
  }
  if (start.componentId !== end.componentId) return null;

  const fScore = new Map<string, number>();
  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();
  const closed = new Set<string>();

  const open = new BinaryHeap<string>((key) => fScore.get(key) ?? Infinity);
  const startH = haversineKm(
    { lat: start.lat, lon: start.lon },
    { lat: end.lat, lon: end.lon },
  );
  gScore.set(startKey, 0);
  fScore.set(startKey, startH);
  open.push(startKey);

  let visited = 0;
  while (open.size > 0) {
    const cur = open.pop()!;
    if (closed.has(cur)) continue; // stale heap entry
    closed.add(cur);
    visited++;
    if (visited > A_STAR_NODE_BUDGET) {
      logger.warn({
        operation: "marnet_a_star_budget_exhausted",
        startKey,
        endKey,
        visited,
      });
      return null;
    }

    if (cur === endKey) {
      const coords: [number, number][] = [];
      let k: string | undefined = cur;
      while (k !== undefined) {
        const n = graph.nodes.get(k)!;
        coords.unshift([n.lon, n.lat]);
        k = cameFrom.get(k);
      }
      return { coords, lengthKm: gScore.get(endKey)!, visitedNodes: visited };
    }

    const curNode = graph.nodes.get(cur)!;
    const curG = gScore.get(cur)!;
    for (const edge of curNode.edges) {
      if (closed.has(edge.neighborKey)) continue;
      const tentativeG = curG + edge.lengthKm;
      const knownG = gScore.get(edge.neighborKey);
      if (knownG !== undefined && tentativeG >= knownG) continue;
      cameFrom.set(edge.neighborKey, cur);
      gScore.set(edge.neighborKey, tentativeG);
      const nb = graph.nodes.get(edge.neighborKey)!;
      const h = haversineKm(
        { lat: nb.lat, lon: nb.lon },
        { lat: end.lat, lon: end.lon },
      );
      fScore.set(edge.neighborKey, tentativeG + h);
      open.push(edge.neighborKey); // duplicates accepted; closed-set filters them
    }
  }

  return null;
}
