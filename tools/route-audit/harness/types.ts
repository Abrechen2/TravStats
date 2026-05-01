/**
 * Pluggable routing-strategy types for the autonomous test harness.
 *
 * Each strategy is a pure function that takes two ports and returns a
 * polyline. The runner in `runner.ts` exercises every registered
 * strategy against every demo leg, collects metrics, and emits per-
 * strategy GeoJSON for visual diff in geojson.io.
 */

export interface Port {
  readonly id: number;
  readonly name: string;
  readonly city: string;
  readonly country: string;
  readonly unlocode: string;
  readonly lat: number;
  readonly lon: number;
}

export type Waypoint = readonly [number, number];

export interface StrategyResult {
  /** [lon, lat] points. First MUST equal `dep`, last MUST equal `arr`. */
  readonly waypoints: ReadonlyArray<Waypoint>;
  /** Optional debug payload (e.g., snap distance, marnet hits used). */
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface Strategy {
  readonly name: string;
  readonly description: string;
  /** Compute waypoints. Throw on permanent failure; return single
   * [dep, arr] chord on disconnected/landlocked ports. */
  readonly route: (dep: Port, arr: Port) => Promise<StrategyResult>;
}

export interface LegMetrics {
  /** Source-of-truth waypoint list AFTER any strategy-internal smoothing. */
  readonly waypoints: ReadonlyArray<Waypoint>;
  readonly chordKm: number;
  readonly polylineKm: number;
  readonly detourRatio: number;
  /** Worst |bearing change| between consecutive segments, in degrees. */
  readonly worstKinkDeg: number;
  /** Count of bearing changes ≥ 90°. */
  readonly kinkCount90: number;
  /** Count of bearing changes ≥ 120°. */
  readonly kinkCount120: number;
  /** Count of bearing changes ≥ 150°. */
  readonly kinkCount150: number;
  /** Σ((Δbearing in radians)² / segment length km) — total bending energy. */
  readonly bendingEnergy: number;
  /** Number of polyline samples (every 0.05°) that fall on land per the fine mask. */
  readonly landSampleCount: number;
  /** % of polyline length that crosses land per the fine mask. */
  readonly landFractionPct: number;
  /** Variance of segment lengths (km) — high = "44 km then 3 km" noise. */
  readonly segmentLengthVarianceKm2: number;
}

export interface StrategyLegOutcome {
  readonly cruise: string;
  readonly legIndex: number;
  readonly dep: Port;
  readonly arr: Port;
  readonly metrics: LegMetrics;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly errored: boolean;
  readonly errorMessage: string | null;
  readonly elapsedMs: number;
}

export interface StrategySummary {
  readonly name: string;
  readonly description: string;
  readonly legsTotal: number;
  readonly legsErrored: number;
  readonly legsClean: number;
  readonly legsKinky90: number;
  readonly legsKinky120: number;
  readonly legsKinky150: number;
  readonly worstKinkDeg: number;
  readonly meanWorstKinkDeg: number;
  readonly p95WorstKinkDeg: number;
  readonly meanBendingEnergy: number;
  readonly meanDetourRatio: number;
  readonly p95DetourRatio: number;
  readonly meanLandFractionPct: number;
  readonly maxLandFractionPct: number;
  readonly totalElapsedMs: number;
}
