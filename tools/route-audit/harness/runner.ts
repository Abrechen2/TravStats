/**
 * Harness runner — exercises every registered strategy against every
 * demo leg, computes metrics, writes per-strategy GeoJSON, and prints a
 * comparison table.
 *
 * Invoke with:
 *   cd /d/Projekte/TravStats
 *   npx tsx tools/route-audit/harness/runner.ts [strategyName]
 *
 * Pass an optional positional arg to run a single strategy (faster
 * iteration during development). With no arg, all strategies run.
 */
import fs from 'fs';
import path from 'path';
import { setMarnetGraphForTesting } from '../../../backend/src/services/marnet/marnetGraph';
import { clearSchematicRouteCache } from '../../../backend/src/services/schematicRouter';
import { strategies } from './registry';
import { computeLegMetrics, mean, percentile } from './metrics';
import { buildDemoLegs, makeIsLand } from './loaders';
import { exportStrategyGeoJson, exportSummaryJson, renderSummaryTable } from './exporters';
import type { Strategy, StrategyLegOutcome, StrategySummary } from './types';

const OUT_DIR = path.resolve(__dirname, '..', 'harness-out');

function summarise(strategy: Strategy, outcomes: ReadonlyArray<StrategyLegOutcome>): StrategySummary {
  const valid = outcomes.filter((o) => !o.errored);
  const worsts = valid.map((o) => o.metrics.worstKinkDeg);
  const detours = valid.map((o) => o.metrics.detourRatio);
  const land = valid.map((o) => o.metrics.landFractionPct);
  return {
    name: strategy.name,
    description: strategy.description,
    legsTotal: outcomes.length,
    legsErrored: outcomes.length - valid.length,
    legsClean: valid.filter((o) => o.metrics.kinkCount90 === 0).length,
    legsKinky90: valid.filter((o) => o.metrics.kinkCount90 > 0).length,
    legsKinky120: valid.filter((o) => o.metrics.kinkCount120 > 0).length,
    legsKinky150: valid.filter((o) => o.metrics.kinkCount150 > 0).length,
    worstKinkDeg: Math.max(0, ...worsts),
    meanWorstKinkDeg: mean(worsts),
    p95WorstKinkDeg: percentile(worsts, 95),
    meanBendingEnergy: mean(valid.map((o) => o.metrics.bendingEnergy)),
    meanDetourRatio: mean(detours),
    p95DetourRatio: percentile(detours, 95),
    meanLandFractionPct: mean(land),
    maxLandFractionPct: Math.max(0, ...land),
    totalElapsedMs: outcomes.reduce((s, o) => s + o.elapsedMs, 0),
  };
}

async function runStrategy(
  strategy: Strategy,
  legs: ReadonlyArray<ReturnType<typeof buildDemoLegs>['legs'][number]>,
  isLand: (lat: number, lon: number) => boolean,
): Promise<StrategyLegOutcome[]> {
  const outcomes: StrategyLegOutcome[] = [];
  // Reset state in case a previous strategy injected a test graph.
  setMarnetGraphForTesting(null);
  clearSchematicRouteCache();
  for (const leg of legs) {
    const t0 = Date.now();
    try {
      const result = await strategy.route(leg.dep, leg.arr);
      const metrics = computeLegMetrics(result.waypoints, isLand);
      outcomes.push({
        cruise: leg.cruise,
        legIndex: leg.legIndex,
        dep: leg.dep,
        arr: leg.arr,
        metrics,
        meta: result.meta,
        errored: false,
        errorMessage: null,
        elapsedMs: Date.now() - t0,
      });
    } catch (err) {
      outcomes.push({
        cruise: leg.cruise,
        legIndex: leg.legIndex,
        dep: leg.dep,
        arr: leg.arr,
        metrics: computeLegMetrics([[leg.dep.lon, leg.dep.lat], [leg.arr.lon, leg.arr.lat]], isLand),
        meta: undefined,
        errored: true,
        errorMessage: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - t0,
      });
    }
  }
  return outcomes;
}

async function main(): Promise<void> {
  const requested = process.argv[2];
  const isLand = makeIsLand();
  const { legs, missing } = buildDemoLegs();
  if (missing.length > 0) console.warn(`Missing ports: ${missing.join(', ')}`);
  console.log(`Demo legs: ${legs.length}`);

  const selected: Strategy[] = requested
    ? strategies.filter((s) => s.name === requested)
    : [...strategies];
  if (requested && selected.length === 0) {
    console.error(`Unknown strategy "${requested}". Known: ${strategies.map((s) => s.name).join(', ')}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const summaries: StrategySummary[] = [];
  const outcomesByStrategy = new Map<string, ReadonlyArray<StrategyLegOutcome>>();

  for (const strategy of selected) {
    const t0 = Date.now();
    const outcomes = await runStrategy(strategy, legs, isLand);
    outcomesByStrategy.set(strategy.name, outcomes);
    const summary = summarise(strategy, outcomes);
    summaries.push(summary);
    const file = exportStrategyGeoJson(OUT_DIR, strategy.name, outcomes);
    console.log(`[${strategy.name}] kinks≥90=${summary.legsKinky90}/${summary.legsTotal} ` +
      `worst=${summary.worstKinkDeg.toFixed(1)}° land=${summary.meanLandFractionPct.toFixed(1)}% ` +
      `(${Date.now() - t0}ms) → ${path.basename(file)}`);
  }

  console.log('\n=== Strategy comparison ===');
  console.log(renderSummaryTable(summaries));
  const summaryFile = exportSummaryJson(OUT_DIR, summaries, outcomesByStrategy);
  console.log(`\nSummary JSON: ${summaryFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
