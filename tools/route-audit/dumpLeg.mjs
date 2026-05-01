import fs from 'fs';
import path from 'path';
const file = path.resolve(process.argv[2]);
const cruise = process.argv[3];
const legIndex = Number(process.argv[4] ?? 0);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const route = data.features.find(
  (f) => f.properties?.kind === 'route' && f.properties?.cruise === cruise && f.properties?.legIndex === legIndex,
);
if (!route) { console.log('not found'); process.exit(1); }
console.log(`${cruise} #${legIndex}  ${route.properties.leg}`);
console.log(`  method=${route.properties.method}  worst=${route.properties.worstDelta} deg  kinks=${route.properties.kinkCount}  wpts=${route.properties.waypointCount}`);
route.geometry.coordinates.forEach((c, i) => {
  console.log(`  ${i.toString().padStart(2)}: [${c[0].toFixed(3).padStart(8)}, ${c[1].toFixed(3).padStart(7)}]`);
});
