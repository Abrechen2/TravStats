import type { RouteMethod, LonLat, Port } from "../types";
import { haversineKm, polylineLengthKm, slerp } from "../geo";

/**
 * Hand-curated maritime waypoints — the "if a captain drew it on a
 * napkin" graph. Each waypoint is a lat/lon node; the list is
 * deliberately small so the all-pairs shortest-path stays trivial.
 * Extend by adding more entries; add edges by picking the nearest
 * neighbours that are plausibly reachable without land crossings.
 */
interface Waypoint {
  id: string;
  lat: number;
  lon: number;
}

const WAYPOINTS: Waypoint[] = [
  { id: "elbe-mouth", lat: 53.9, lon: 8.3 },
  { id: "skagen", lat: 57.7, lon: 10.6 },
  { id: "oresund-n", lat: 56.1, lon: 12.5 },
  { id: "oresund-s", lat: 55.3, lon: 12.7 },
  { id: "fehmarn", lat: 54.5, lon: 11.3 },
  { id: "dover", lat: 51.0, lon: 1.5 },
  { id: "ushant", lat: 48.5, lon: -5.1 },
  { id: "finisterre", lat: 43.0, lon: -10.0 },
  { id: "gibraltar", lat: 35.95, lon: -5.6 },
  { id: "cap-bon", lat: 37.1, lon: 11.0 },
  { id: "messina", lat: 38.2, lon: 15.6 },
  { id: "malta", lat: 35.9, lon: 14.5 },
  { id: "suez-north", lat: 31.25, lon: 32.3 },
  { id: "suez-south", lat: 29.9, lon: 32.6 },
  { id: "bab-el-mandeb", lat: 12.6, lon: 43.4 },
  { id: "hormuz", lat: 26.6, lon: 56.3 },
  { id: "malacca-n", lat: 5.5, lon: 100.0 },
  { id: "malacca-s", lat: 1.3, lon: 103.8 },
  { id: "aleutian-atl", lat: 55.0, lon: -45.0 },
  { id: "aleutian-pac", lat: 50.0, lon: -170.0 },
  { id: "panama-atl", lat: 9.3, lon: -79.9 },
  { id: "panama-pac", lat: 8.8, lon: -79.5 },
  { id: "florida-strait", lat: 24.5, lon: -80.0 },
  { id: "sunda", lat: -6.0, lon: 105.8 },
  { id: "cape-of-good-hope", lat: -34.4, lon: 18.5 },
  { id: "tasman", lat: -40.0, lon: 165.0 },
];

// Edges hand-picked from the waypoint list. Each entry is an unordered
// pair `{a, b}`; both directions are used. Not encoded as a matrix so
// the data stays readable.
const EDGES: ReadonlyArray<readonly [string, string]> = [
  ["elbe-mouth", "skagen"],
  ["skagen", "oresund-n"],
  ["oresund-n", "oresund-s"],
  ["oresund-s", "fehmarn"],
  ["fehmarn", "elbe-mouth"],
  ["elbe-mouth", "dover"],
  ["dover", "ushant"],
  ["ushant", "finisterre"],
  ["finisterre", "gibraltar"],
  ["gibraltar", "cap-bon"],
  ["cap-bon", "messina"],
  ["messina", "malta"],
  ["malta", "suez-north"],
  ["suez-north", "suez-south"],
  ["suez-south", "bab-el-mandeb"],
  ["bab-el-mandeb", "hormuz"],
  ["bab-el-mandeb", "malacca-n"],
  ["malacca-n", "malacca-s"],
  ["malacca-s", "sunda"],
  ["ushant", "aleutian-atl"],
  ["aleutian-atl", "panama-atl"],
  ["panama-atl", "panama-pac"],
  ["panama-pac", "aleutian-pac"],
  ["aleutian-pac", "tasman"],
  ["malacca-s", "tasman"],
  ["finisterre", "cape-of-good-hope"],
  ["cape-of-good-hope", "tasman"],
  ["cape-of-good-hope", "bab-el-mandeb"],
  ["florida-strait", "panama-atl"],
  ["florida-strait", "aleutian-atl"],
];

interface Graph {
  nodes: Map<string, Waypoint>;
  edges: Map<string, string[]>;
}

function buildGraph(): Graph {
  const nodes = new Map(WAYPOINTS.map((w) => [w.id, w]));
  const edges = new Map<string, string[]>();
  for (const w of WAYPOINTS) edges.set(w.id, []);
  for (const [a, b] of EDGES) {
    edges.get(a)!.push(b);
    edges.get(b)!.push(a);
  }
  return { nodes, edges };
}

const GRAPH = buildGraph();

function nearestWaypoint(port: Port): Waypoint {
  let best: Waypoint = WAYPOINTS[0];
  let bestD = Infinity;
  for (const w of WAYPOINTS) {
    const d = haversineKm([port.lon, port.lat], [w.lon, w.lat]);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return best;
}

function dijkstra(startId: string, goalId: string): string[] | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  dist.set(startId, 0);
  while (visited.size < GRAPH.nodes.size) {
    let bestId: string | null = null;
    let bestD = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < bestD) {
        bestD = d;
        bestId = id;
      }
    }
    if (bestId === null) break;
    if (bestId === goalId) {
      const path = [bestId];
      while (prev.has(path[0])) path.unshift(prev.get(path[0])!);
      return path;
    }
    visited.add(bestId);
    const cur = GRAPH.nodes.get(bestId)!;
    for (const nId of GRAPH.edges.get(bestId) ?? []) {
      if (visited.has(nId)) continue;
      const n = GRAPH.nodes.get(nId)!;
      const alt = bestD + haversineKm([cur.lon, cur.lat], [n.lon, n.lat]);
      if (alt < (dist.get(nId) ?? Infinity)) {
        dist.set(nId, alt);
        prev.set(nId, bestId);
      }
    }
  }
  return null;
}

export const waypointGraphMethod: RouteMethod = {
  id: "waypoint-graph",
  label: "Waypoint graph",
  color: "#60a5fa",
  description: "Hand-curated maritime checkpoints + Dijkstra. Sampled sphericallly.",
  defaultOn: true,
  compute: async (pair) => {
    const t0 = performance.now();
    const startWp = nearestWaypoint(pair.from);
    const goalWp = nearestWaypoint(pair.to);
    const path = dijkstra(startWp.id, goalWp.id);
    const ms = performance.now() - t0;
    if (!path) {
      const chord: LonLat[] = [
        [pair.from.lon, pair.from.lat],
        [pair.to.lon, pair.to.lat],
      ];
      return {
        coordinates: chord,
        distanceKm: polylineLengthKm(chord),
        computeMs: ms,
        note: "no graph path — straight chord",
      };
    }
    // Materialise the route: port → first waypoint → … → last waypoint
    // → port. Each segment is slerped so global hops curve properly.
    const pts: LonLat[] = [];
    const SAMPLES_PER_LEG = 24;
    const seq: LonLat[] = [
      [pair.from.lon, pair.from.lat],
      ...path.map((id) => {
        const w = GRAPH.nodes.get(id)!;
        return [w.lon, w.lat] as LonLat;
      }),
      [pair.to.lon, pair.to.lat],
    ];
    for (let i = 0; i < seq.length - 1; i++) {
      for (let s = 0; s < SAMPLES_PER_LEG; s++) {
        pts.push(slerp(seq[i], seq[i + 1], s / SAMPLES_PER_LEG));
      }
    }
    pts.push(seq[seq.length - 1]);
    return {
      coordinates: pts,
      distanceKm: polylineLengthKm(pts),
      computeMs: ms,
      note: `via ${path.join(" → ")}`,
    };
  },
};
