/**
 * For a given strategy, list the legs with highest land fraction along
 * with sample land hits — helps decide whether the metric is flagging
 * real "route through Italy" land violations or just narrow-strait
 * artefacts that the 0.1° mask resolves as land.
 */
import { strategies } from './registry';
import { buildDemoLegs, makeIsLand } from './loaders';
import {
  MASK_COLS,
  MASK_ROWS,
  cellIndex,
  getBit,
  latToRow,
  lonToCol,
} from '../../../backend/src/shared/geo/landMaskGrid';
import { setMarnetGraphForTesting } from '../../../backend/src/services/marnet/marnetGraph';
import { clearSchematicRouteCache } from '../../../backend/src/services/schematicRouter';
import { loadFineMaskSync } from './loaders';

async function main(): Promise<void> {
  const stratName = process.argv[2] ?? 'baseline_resample_centripetal';
  const strat = strategies.find((s) => s.name === stratName);
  if (!strat) {
    console.error(`Unknown strategy ${stratName}`);
    process.exit(1);
  }
  const isLand = makeIsLand();
  const bytes = loadFineMaskSync();
  const { legs } = buildDemoLegs();

  setMarnetGraphForTesting(null);
  clearSchematicRouteCache();

  type LegInfo = {
    leg: { dep: { name: string }; arr: { name: string } };
    landPct: number;
    landSamples: Array<{ lon: number; lat: number; runStart: number; runLen: number }>;
  };

  const infos: LegInfo[] = [];
  for (const leg of legs) {
    const result = await strat.route(leg.dep, leg.arr);
    const wp = result.waypoints;
    const samples: Array<{ lon: number; lat: number }> = [];
    for (let i = 1; i < wp.length; i++) {
      const [lon0, lat0] = wp[i - 1];
      const [lon1, lat1] = wp[i];
      const dLon = lon1 - lon0;
      const dLat = lat1 - lat0;
      const segDeg = Math.hypot(dLon, dLat);
      const n = Math.max(2, Math.ceil(segDeg / 0.05));
      for (let s = 1; s < n; s++) {
        const t = s / n;
        samples.push({ lon: lon0 + dLon * t, lat: lat0 + dLat * t });
      }
    }
    const landMarks = samples.map((s) => isLand(s.lat, s.lon));
    const landCount = landMarks.filter(Boolean).length;
    const landPct = (landCount / Math.max(1, samples.length)) * 100;
    // Find runs of consecutive land
    const runs: Array<{ lon: number; lat: number; runStart: number; runLen: number }> = [];
    let runStart = -1;
    for (let i = 0; i <= landMarks.length; i++) {
      if (i < landMarks.length && landMarks[i]) {
        if (runStart === -1) runStart = i;
      } else if (runStart !== -1) {
        const mid = Math.floor((runStart + i - 1) / 2);
        runs.push({
          lon: samples[mid].lon,
          lat: samples[mid].lat,
          runStart,
          runLen: i - runStart,
        });
        runStart = -1;
      }
    }
    runs.sort((a, b) => b.runLen - a.runLen);
    infos.push({ leg, landPct, landSamples: runs.slice(0, 3) });
  }

  infos.sort((a, b) => b.landPct - a.landPct);
  console.log(`Top 12 legs by land fraction (${stratName}):`);
  for (const info of infos.slice(0, 12)) {
    console.log(`\n  ${info.leg.dep.name} → ${info.leg.arr.name}: ${info.landPct.toFixed(1)}%`);
    for (const r of info.landSamples) {
      console.log(`    run len=${r.runLen} samples (~${(r.runLen * 5).toFixed(0)} km), midpoint [${r.lon.toFixed(2)}, ${r.lat.toFixed(2)}]`);
    }
  }
  // suppress unused-import warnings
  void MASK_COLS; void MASK_ROWS; void cellIndex; void getBit; void latToRow; void lonToCol; void bytes;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
