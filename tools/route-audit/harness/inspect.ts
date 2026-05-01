/**
 * Side-by-side inspection tool for picking visual winners.
 *
 * For each named strategy, dumps the polylines of the 8 worst-baseline
 * legs in a compact, eyeball-friendly format. Helps spot "metric got
 * better but visual is still wrong" cases without leaving the terminal.
 *
 * Usage:
 *   cd backend
 *   DATABASE_URL=... LOG_LEVEL=warn npx tsx \
 *     ../tools/route-audit/harness/inspect.ts <strategy1> <strategy2> ...
 */
import { strategies } from './registry';
import { buildDemoLegs, makeIsLand } from './loaders';
import { computeLegMetrics } from './metrics';
import { setMarnetGraphForTesting } from '../../../backend/src/services/marnet/marnetGraph';
import { clearSchematicRouteCache } from '../../../backend/src/services/schematicRouter';
import type { Strategy } from './types';

const HOT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['Nassau', 'San Juan'],
  ['Istanbul', 'Santorini'],
  ['Copenhagen', 'Stockholm'],
  ['Bergen', 'Geiranger'],
  ['Hamburg', 'Southampton'],
  ['Kiel', 'Bergen'],
  ['Juneau', 'Skagway'],
  ['Dubrovnik', 'Naples'],
  ['Hamburg', 'Bergen'],
  ['Kiel', 'Copenhagen'],
];

function fmt(coord: readonly [number, number]): string {
  return `[${coord[0].toFixed(2).padStart(7)}, ${coord[1].toFixed(2).padStart(6)}]`;
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2);
  if (requested.length === 0) {
    console.error('Usage: inspect.ts <strategy> [strategy …]');
    process.exit(1);
  }
  const isLand = makeIsLand();
  const { legs } = buildDemoLegs();
  const matchingLegs = legs.filter((l) =>
    HOT_PAIRS.some(([d, a]) => l.dep.name.startsWith(d) && l.arr.name.startsWith(a)),
  );

  for (const stratName of requested) {
    const strat = strategies.find((s): s is Strategy => s.name === stratName);
    if (!strat) {
      console.error(`Unknown strategy "${stratName}"`);
      continue;
    }
    setMarnetGraphForTesting(null);
    clearSchematicRouteCache();
    console.log(`\n══════════ ${strat.name} ══════════`);
    console.log(strat.description);
    for (const leg of matchingLegs) {
      const result = await strat.route(leg.dep, leg.arr);
      const m = computeLegMetrics(result.waypoints, isLand);
      console.log(`\n${leg.dep.name} → ${leg.arr.name}`);
      console.log(`  worstKink ${m.worstKinkDeg.toFixed(1)}°  bend ${m.bendingEnergy.toFixed(2)}  ` +
        `detour ${m.detourRatio.toFixed(2)}  land ${m.landFractionPct.toFixed(1)}%  ` +
        `n=${m.waypoints.length}`);
      const wp = m.waypoints;
      const stride = Math.max(1, Math.floor(wp.length / 12));
      for (let i = 0; i < wp.length; i += stride) console.log(`    ${fmt(wp[i])}`);
      if ((wp.length - 1) % stride !== 0) console.log(`    ${fmt(wp[wp.length - 1])}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
