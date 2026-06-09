import { haversineKm } from "../../../shared/geo/haversine";
import { loadMarnetGraph } from "../marnetGraph";
import {
  buildMarnetGraphForTesting,
  routeMarnet,
  routeMarnetWithGraph,
  setMarnetGraphForTesting,
} from "../marnetRouter";

type LineString = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

const ls = (coords: [number, number][]): LineString => ({
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: coords },
});
const fc = (features: LineString[]) =>
  ({ type: "FeatureCollection" as const, features });

describe("routeMarnetWithGraph — synthetic graph", () => {
  afterEach(() => setMarnetGraphForTesting(null));

  it("snaps two ports to nearest nodes and returns the polyline + snap distances", () => {
    const graph = buildMarnetGraphForTesting(
      fc([
        ls([
          [0, 0],
          [1, 0],
          [2, 0],
          [3, 0],
        ]),
      ]),
    );
    const result = routeMarnetWithGraph(graph, { lat: 0.1, lon: 0.05 }, { lat: -0.1, lon: 3.05 });
    expect(result).not.toBeNull();
    expect(result!.coords[0]).toEqual([0, 0]);
    expect(result!.coords[result!.coords.length - 1]).toEqual([3, 0]);
    // Polyline length is the sum of 3 unit-degree edges.
    expect(result!.lengthKm).toBeCloseTo(3 * 111.195, 0);
    // Snap distances are non-trivial, both ends roughly 0.1° away.
    expect(result!.snapDepKm).toBeGreaterThan(0);
    expect(result!.snapArrKm).toBeGreaterThan(0);
    expect(result!.snapDepKm).toBeLessThan(20);
    expect(result!.snapArrKm).toBeLessThan(20);
  });

  it("returns null when both endpoints snap to the same graph node", () => {
    const graph = buildMarnetGraphForTesting(
      fc([
        ls([
          [0, 0],
          [10, 0],
        ]),
      ]),
    );
    const result = routeMarnetWithGraph(
      graph,
      { lat: 0.001, lon: 0.001 },
      { lat: -0.001, lon: -0.001 },
    );
    expect(result).toBeNull();
  });

  it("returns null when ports snap into different components", () => {
    const graph = buildMarnetGraphForTesting(
      fc([
        ls([
          [0, 0],
          [1, 0],
          [2, 0],
          [3, 0],
        ]),
        ls([
          [50, 50],
          [51, 50],
        ]),
      ]),
    );
    // Force the second port into the small component by allowing it.
    const result = routeMarnetWithGraph(
      graph,
      { lat: 0, lon: 0 },
      { lat: 50, lon: 50 },
      { allowDisconnectedComponents: true },
    );
    expect(result).toBeNull();
  });

  it("rejects when snap exceeds caller-supplied budget", () => {
    const graph = buildMarnetGraphForTesting(
      fc([
        ls([
          [0, 0],
          [1, 0],
        ]),
      ]),
    );
    const result = routeMarnetWithGraph(
      graph,
      { lat: 0, lon: 50 }, // hundreds of km from the only nodes
      { lat: 0, lon: 0 },
      { maxSnapKm: 50 },
    );
    expect(result).toBeNull();
  });
});

describe("routeMarnet — real vendored graph", () => {
  // The real marnet load is ~30 ms. Cache the graph once for the suite.
  beforeAll(async () => {
    await loadMarnetGraph();
  });

  // Known cruise port pairs — chosen to exercise different basins,
  // chokepoint transit, and sparse-graph regions.
  const PORT_PAIRS = [
    {
      name: "Hamburg → Bergen (North Sea + Norwegian fjords)",
      from: { lat: 53.541, lon: 9.984 },
      to: { lat: 60.392, lon: 5.323 },
      maxSnapKm: 200,
    },
    {
      name: "Kiel → Sassnitz (Baltic narrow seas)",
      from: { lat: 54.323, lon: 10.139 },
      to: { lat: 54.518, lon: 13.643 },
      maxSnapKm: 200,
    },
    {
      name: "New York → Southampton (transatlantic)",
      from: { lat: 40.689, lon: -74.045 },
      to: { lat: 50.909, lon: -1.404 },
      maxSnapKm: 100,
    },
    {
      name: "Singapore → Hong Kong (South China Sea)",
      from: { lat: 1.265, lon: 103.823 },
      to: { lat: 22.302, lon: 114.169 },
      maxSnapKm: 150,
    },
    {
      name: "Civitavecchia → Barcelona (West Med)",
      from: { lat: 42.094, lon: 11.79 },
      to: { lat: 41.349, lon: 2.166 },
      maxSnapKm: 150,
    },
    {
      name: "Sydney → Auckland (Tasman Sea)",
      from: { lat: -33.86, lon: 151.21 },
      to: { lat: -36.846, lon: 174.766 },
      maxSnapKm: 200,
    },
    {
      name: "Miami → Cozumel (Gulf / Caribbean)",
      from: { lat: 25.78, lon: -80.193 },
      to: { lat: 20.509, lon: -86.945 },
      maxSnapKm: 200,
    },
    {
      name: "Hamburg → Tokyo via Suez (multi-chokepoint)",
      from: { lat: 53.541, lon: 9.984 },
      to: { lat: 35.622, lon: 139.78 },
      maxSnapKm: 250,
    },
  ];

  it.each(PORT_PAIRS)("routes %s", async ({ from, to, maxSnapKm }) => {
    const result = await routeMarnet(from, to, { maxSnapKm });
    expect(result).not.toBeNull();

    const polylineCoordCount = result!.coords.length;
    expect(polylineCoordCount).toBeGreaterThanOrEqual(2);

    // Sanity: returned polyline length is at most a small multiple of
    // the chord — guards against catastrophic A* misbehaviour where
    // the path zigzags around the world. Threshold tuned to match the
    // marnetCalculator overshoot cap (×3.5) plus a 30% safety margin.
    const chordKm = haversineKm(from, to);
    expect(result!.lengthKm).toBeGreaterThan(0);
    expect(result!.lengthKm).toBeLessThan(chordKm * 5);

    // Visited-node guard — A* on this graph for any real cruise leg
    // explores far fewer than 5000 nodes.
    expect(result!.visitedNodes).toBeLessThan(10_000);
  });

  it("Suez transit: Hamburg→Tokyo polyline crosses the Bab-el-Mandeb / Gulf of Aden corridor", async () => {
    const result = await routeMarnet(
      { lat: 53.541, lon: 9.984 },
      { lat: 35.622, lon: 139.78 },
      { maxSnapKm: 250 },
    );
    expect(result).not.toBeNull();
    // Look for any coordinate inside the Red Sea / Gulf-of-Aden
    // corridor — only the Suez routing reaches it. A circumnavigation
    // via Cape Horn would skip this region entirely.
    const passesSuezCorridor = result!.coords.some(
      ([lon, lat]) => lon > 30 && lon < 55 && lat > 10 && lat < 30,
    );
    expect(passesSuezCorridor).toBe(true);
  });

  it("Panama transit: NYC→Los Angeles routes through the Caribbean → Panama → East Pacific", async () => {
    const result = await routeMarnet(
      { lat: 40.689, lon: -74.045 }, // New York harbour
      { lat: 33.74, lon: -118.27 }, // Long Beach / Los Angeles
      { maxSnapKm: 150 },
    );
    expect(result).not.toBeNull();
    // Any coord in the Panama Canal / approaches band confirms transit.
    const passesPanama = result!.coords.some(
      ([lon, lat]) => lon > -82 && lon < -77 && lat > 7 && lat < 11,
    );
    expect(passesPanama).toBe(true);
    // And a coord on the Pacific side confirms emergence.
    const reachesPacific = result!.coords.some(([lon]) => lon < -85);
    expect(reachesPacific).toBe(true);
  });

  it("snap distances stay reasonable for major cruise ports", async () => {
    const ports = [
      { name: "Hamburg", lat: 53.541, lon: 9.984 },
      { name: "Kiel", lat: 54.323, lon: 10.139 },
      { name: "Southampton", lat: 50.909, lon: -1.404 },
      { name: "Civitavecchia", lat: 42.094, lon: 11.79 },
      { name: "Singapore", lat: 1.265, lon: 103.823 },
      { name: "Miami", lat: 25.78, lon: -80.193 },
    ];
    for (const a of ports) {
      for (const b of ports) {
        if (a === b) continue;
        const result = await routeMarnet(a, b, { maxSnapKm: 250 });
        expect(result).not.toBeNull();
        // No port should be unreachable from another major port.
        // Both snap distances must stay within budget.
        expect(result!.snapDepKm).toBeLessThan(250);
        expect(result!.snapArrKm).toBeLessThan(250);
      }
    }
  });
});
