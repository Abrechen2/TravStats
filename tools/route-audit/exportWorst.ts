/**
 * Emit a focused "worst-N" GeoJSON with full polylines + kink markers,
 * sorted by worst kink severity descending. For visual triage in
 * https://geojson.io/.
 */
import fs from 'fs';
import path from 'path';

interface Kink {
  index: number;
  at: [number, number];
  prev: [number, number];
  next: [number, number];
  deltaDeg: number;
  prevSegKm: number;
  nextSegKm: number;
}

interface LegResult {
  cruise: string;
  legIndex: number;
  dep: string;
  arr: string;
  method: string;
  routed: boolean;
  waypointCount: number;
  chordKm: number;
  polylineKm: number;
  kinks: Kink[];
  worstDeltaDeg: number;
}

const audit = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'audit.json'), 'utf8'),
) as { results: LegResult[] };

const fullRoutes = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'full-routes.geojson'), 'utf8'),
) as {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown>;
  }>;
};

const TOP_N = 20;

const worst = audit.results
  .filter((r) => r.kinks.length > 0)
  .sort((a, b) => b.worstDeltaDeg - a.worstDeltaDeg)
  .slice(0, TOP_N);

const labels = new Set(worst.map((r) => `${r.cruise}|${r.legIndex}`));

const features = fullRoutes.features.filter((f) => {
  const props = f.properties;
  if (props.kind === 'route') return labels.has(`${props.cruise}|${props.legIndex}`);
  // For kink points: keep only those whose (cruise, leg) pair is in worst.
  // Kink points don't carry legIndex but they carry cruise + leg-string;
  // match by cruise + leg-string against worst[].
  if (props.kind === 'kink') {
    return worst.some(
      (r) =>
        r.cruise === props.cruise &&
        `${r.dep} → ${r.arr}` === props.leg,
    );
  }
  return false;
});

fs.writeFileSync(
  path.resolve(__dirname, 'worst20.geojson'),
  JSON.stringify({ type: 'FeatureCollection', features }, null, 2),
);

console.log(`Worst-${TOP_N} legs:`);
worst.forEach((r, i) => {
  console.log(
    `  ${(i + 1).toString().padStart(2)}. ${r.dep} → ${r.arr}  (${r.cruise}) — worst ${r.worstDeltaDeg}°, ${r.kinks.length} kink(s), method=${r.method}`,
  );
});
console.log(`\nWrote ${features.length} features → tools/route-audit/worst20.geojson`);
