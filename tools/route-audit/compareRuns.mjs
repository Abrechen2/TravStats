/**
 * Compare two GeoJSON audit dumps (before-fix.geojson vs after-fix.geojson)
 * leg-by-leg. Reports improvements, regressions, unchanged.
 */
import fs from 'fs';
import path from 'path';

const root = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const before = JSON.parse(fs.readFileSync(path.join(root, 'before-fix.geojson'), 'utf8'));
const after = JSON.parse(fs.readFileSync(path.join(root, 'after-fix.geojson'), 'utf8'));

function indexRoutes(fc) {
  const m = new Map();
  for (const f of fc.features) {
    if (f.properties?.kind !== 'route') continue;
    const k = `${f.properties.cruise}|${f.properties.legIndex}`;
    m.set(k, {
      leg: f.properties.leg,
      method: f.properties.method,
      worstDelta: f.properties.worstDelta ?? 0,
      kinkCount: f.properties.kinkCount ?? 0,
      waypointCount: f.properties.waypointCount,
    });
  }
  return m;
}

const beforeMap = indexRoutes(before);
const afterMap = indexRoutes(after);

const improved = [];
const worse = [];
const unchanged = [];
const newRegressions = []; // had no kinks, now does

for (const [k, b] of beforeMap) {
  const a = afterMap.get(k);
  if (!a) continue;
  const dDelta = a.worstDelta - b.worstDelta;
  const dKinks = a.kinkCount - b.kinkCount;
  if (b.kinkCount > 0 && a.kinkCount === 0) {
    improved.push({ k, b, a, label: 'fixed' });
  } else if (b.kinkCount === 0 && a.kinkCount > 0) {
    newRegressions.push({ k, b, a });
  } else if (dDelta < -10) {
    improved.push({ k, b, a, label: 'milder' });
  } else if (dDelta > 10) {
    worse.push({ k, b, a });
  } else {
    unchanged.push({ k, b, a });
  }
}

const fmt = (e, key) => `${e[key].leg}  worst=${e[key].worstDelta.toFixed(1).padStart(5)}°  kinks=${e[key].kinkCount}  method=${e[key].method}`;

console.log(`Total legs: before=${beforeMap.size}  after=${afterMap.size}`);
console.log(`  Fully fixed  (kinks → 0):     ${improved.filter((e) => e.label === 'fixed').length}`);
console.log(`  Milder       (worst -10°+):    ${improved.filter((e) => e.label === 'milder').length}`);
console.log(`  Unchanged    (Δ ≤ 10°):       ${unchanged.length}`);
console.log(`  Regressions  (worst +10°+):    ${worse.length}`);
console.log(`  New kinks    (was clean):     ${newRegressions.length}`);

console.log('\n=== Fully fixed ===');
improved.filter((e) => e.label === 'fixed').forEach((e) => console.log(`  ${fmt(e, 'b')}  →  ${fmt(e, 'a')}`));

console.log('\n=== Milder (smaller worst delta) ===');
improved.filter((e) => e.label === 'milder').forEach((e) => {
  const d = (e.a.worstDelta - e.b.worstDelta).toFixed(1);
  console.log(`  ${e.b.leg}: ${e.b.worstDelta.toFixed(1)}° → ${e.a.worstDelta.toFixed(1)}° (Δ ${d}°)  method ${e.b.method} → ${e.a.method}`);
});

console.log('\n=== Regressions (worst grew ≥10°) ===');
worse.forEach((e) => {
  const d = (e.a.worstDelta - e.b.worstDelta).toFixed(1);
  console.log(`  ${e.b.leg}: ${e.b.worstDelta.toFixed(1)}° → ${e.a.worstDelta.toFixed(1)}° (Δ +${d}°)  method ${e.b.method} → ${e.a.method}`);
});

console.log('\n=== New kinks (was clean, now problematic) ===');
newRegressions.forEach((e) => {
  console.log(`  ${e.b.leg}: 0° → ${e.a.worstDelta.toFixed(1)}°  method ${e.b.method} → ${e.a.method}`);
});
