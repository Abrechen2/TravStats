import {
  buildMarnetGraphForTesting,
  findMarnetPath,
  findNearestNode,
  nodeKey,
  setMarnetGraphForTesting,
} from "../marnetGraph";

type LineString = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

function ls(coords: [number, number][]): LineString {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

function fc(features: LineString[]) {
  return { type: "FeatureCollection" as const, features };
}

describe("marnetGraph — internals", () => {
  afterEach(() => setMarnetGraphForTesting(null));

  describe("nodeKey", () => {
    it("rounds to 4 decimals and reuses the same key for sub-precision drift", () => {
      expect(nodeKey(9.876543, 53.123456)).toBe("9.8765,53.1235");
      expect(nodeKey(9.87654321, 53.12345678)).toBe("9.8765,53.1235");
    });

    it("keeps coordinates that differ above the precision distinct", () => {
      expect(nodeKey(9.8765, 53.1235)).not.toBe(nodeKey(9.8766, 53.1235));
    });

    it("preserves sign across the antimeridian", () => {
      expect(nodeKey(-179.9999, 0)).toBe("-179.9999,0.0000");
      expect(nodeKey(179.9999, 0)).toBe("179.9999,0.0000");
    });
  });

  describe("graph build", () => {
    it("merges shared endpoints into one node", () => {
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [1, 0],
          ]),
          ls([
            [1, 0],
            [2, 0],
          ]),
        ]),
      );
      // Shared (1,0) point becomes one node, total 3 unique nodes.
      expect(graph.nodes.size).toBe(3);
      const shared = graph.nodes.get(nodeKey(1, 0));
      expect(shared).toBeDefined();
      expect(shared!.edges).toHaveLength(2);
    });

    it("dedupes endpoints separated only by sub-precision noise", () => {
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [1.000001, 0.000001],
          ]),
          ls([
            [1, 0],
            [2, 0],
          ]),
        ]),
      );
      expect(graph.nodes.size).toBe(3);
    });

    it("computes haversine edge weights, not chord lengths", () => {
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [1, 0],
          ]),
        ]),
      );
      const a = graph.nodes.get(nodeKey(0, 0))!;
      // 1° of longitude at the equator ≈ 111.195 km via haversine.
      expect(a.edges[0].lengthKm).toBeCloseTo(111.195, 1);
    });

    it("ignores degenerate edges where both endpoints round to the same key", () => {
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [0.00001, 0.00001], // collapses to the same key
            [1, 0],
          ]),
        ]),
      );
      const start = graph.nodes.get(nodeKey(0, 0))!;
      // Only one edge — the degenerate self-edge was suppressed.
      expect(start.edges).toHaveLength(1);
    });

    it("labels disconnected components and identifies the largest", () => {
      const graph = buildMarnetGraphForTesting(
        fc([
          // Big component — 4 nodes
          ls([
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
          ]),
          // Small component — 2 nodes
          ls([
            [50, 50],
            [51, 50],
          ]),
        ]),
      );
      expect(graph.componentSizes.size).toBe(2);
      const sizes = [...graph.componentSizes.values()].sort((a, b) => b - a);
      expect(sizes).toEqual([4, 2]);
      const big = graph.nodes.get(nodeKey(0, 0))!;
      expect(big.componentId).toBe(graph.largestComponentId);
      const small = graph.nodes.get(nodeKey(50, 50))!;
      expect(small.componentId).not.toBe(graph.largestComponentId);
    });
  });

  describe("findNearestNode", () => {
    it("returns the closest node in the centre bucket", () => {
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [1, 0],
            [2, 0],
          ]),
        ]),
      );
      const result = findNearestNode(graph, 0.4, 1.1);
      expect(result).not.toBeNull();
      expect(result!.node.key).toBe(nodeKey(1, 0));
    });

    it("expands rings to find a node when none sit in the centre bucket", () => {
      // Single line of nodes at lon ~1, querying at lon ~25 — node is 2-3 buckets away.
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [1, 0],
          ]),
        ]),
      );
      const result = findNearestNode(graph, 0, 25);
      expect(result).not.toBeNull();
      expect(result!.node.key).toBe(nodeKey(1, 0));
    });

    it("filters out nodes from non-largest components by default", () => {
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
          ]),
          // Tiny isolated component very close to the query point.
          ls([
            [10, 10],
            [10.5, 10.5],
          ]),
        ]),
      );
      const result = findNearestNode(graph, 10, 10);
      // With onlyMainComponent=true (default), the (10,10) point is
      // skipped even though it's "closer", and we land on the big component.
      expect(result).not.toBeNull();
      expect(result!.node.componentId).toBe(graph.largestComponentId);
    });

    it("includes disconnected components when explicitly allowed", () => {
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
          ]),
          ls([
            [10, 10],
            [10.5, 10.5],
          ]),
        ]),
      );
      const result = findNearestNode(graph, 10, 10, { onlyMainComponent: false });
      expect(result).not.toBeNull();
      expect(result!.node.key).toBe(nodeKey(10, 10));
    });

    it("wraps longitude across the antimeridian", () => {
      // Two nodes ~10° apart by great-circle distance, but
      // numerically on opposite sides of ±180.
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [-179, 0],
            [-178, 0],
          ]),
        ]),
      );
      const result = findNearestNode(graph, 0, 179);
      expect(result).not.toBeNull();
      // Closer node is at lon=-179 (≈2° away) when treated correctly.
      // Without antimeridian-aware bucket scanning the search misses it
      // entirely on a 10° bucket grid.
      expect(result!.node.key).toBe(nodeKey(-179, 0));
    });
  });

  describe("findMarnetPath", () => {
    it("returns a single-node path when start === end", () => {
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [1, 0],
          ]),
        ]),
      );
      const path = findMarnetPath(graph, nodeKey(0, 0), nodeKey(0, 0));
      expect(path).not.toBeNull();
      expect(path!.coords).toHaveLength(1);
      expect(path!.lengthKm).toBe(0);
    });

    it("finds the optimal path along a simple chain", () => {
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
            [4, 0],
          ]),
        ]),
      );
      const path = findMarnetPath(graph, nodeKey(0, 0), nodeKey(4, 0));
      expect(path).not.toBeNull();
      expect(path!.coords).toEqual([
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [4, 0],
      ]);
      // ~4 × 111.195 km ≈ 444.78 km
      expect(path!.lengthKm).toBeCloseTo(4 * 111.195, 0);
    });

    it("picks the shorter of two alternative routes", () => {
      // Diamond: short path 0→1→2 (2 km), detour 0→3→2 (≫ km).
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [0.01, 0],
            [0.02, 0],
          ]),
          ls([
            [0, 0],
            [5, 5],
            [0.02, 0],
          ]),
        ]),
      );
      const path = findMarnetPath(graph, nodeKey(0, 0), nodeKey(0.02, 0));
      expect(path).not.toBeNull();
      expect(path!.coords).toEqual([
        [0, 0],
        [0.01, 0],
        [0.02, 0],
      ]);
    });

    it("returns null when start and end are in different components", () => {
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [1, 0],
          ]),
          ls([
            [50, 50],
            [51, 50],
          ]),
        ]),
      );
      const path = findMarnetPath(graph, nodeKey(0, 0), nodeKey(50, 50));
      expect(path).toBeNull();
    });

    it("returns null when either endpoint is unknown to the graph", () => {
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [1, 0],
          ]),
        ]),
      );
      expect(findMarnetPath(graph, "9.9999,9.9999", nodeKey(1, 0))).toBeNull();
      expect(findMarnetPath(graph, nodeKey(0, 0), "9.9999,9.9999")).toBeNull();
    });

    it("handles graphs with parallel/duplicate edges without looping", () => {
      // Same coords appear twice — addEdge dedupes by neighbor key, but
      // we exercise the path through it to be sure.
      const graph = buildMarnetGraphForTesting(
        fc([
          ls([
            [0, 0],
            [1, 0],
            [2, 0],
          ]),
          ls([
            [0, 0],
            [1, 0],
            [2, 0],
          ]),
          ls([
            [1, 0],
            [1, 0], // self-edge — must be ignored
          ]),
        ]),
      );
      const path = findMarnetPath(graph, nodeKey(0, 0), nodeKey(2, 0));
      expect(path).not.toBeNull();
      expect(path!.coords.length).toBe(3);
    });
  });
});
