/**
 * Convert audit.json into two GeoJSON FeatureCollections:
 *   - routes.geojson: every leg as a LineString, properties.worstDeltaDeg
 *   - kinks.geojson:  every kink anchor as a Point, properties.deltaDeg
 *
 * Drop both into https://geojson.io/ to see the kinks visually.
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

const auditFile = path.resolve(__dirname, 'audit.json');
const audit = JSON.parse(fs.readFileSync(auditFile, 'utf8')) as {
  results: LegResult[];
};

// Routes: LineStrings reconstructed from kink list (we don't store the full
// polyline in audit.json, so this needs the raw waypoints — let's emit just
// the kink-context segments per leg).
const routes = {
  type: 'FeatureCollection',
  features: audit.results.map((leg) => {
    const wpts: [number, number][] = [];
    leg.kinks.forEach((k) => {
      if (wpts.length === 0) wpts.push(k.prev);
      wpts.push(k.at);
      wpts.push(k.next);
    });
    if (wpts.length === 0) return null;
    return {
      type: 'Feature',
      geometry: { type: 'MultiPoint', coordinates: wpts },
      properties: {
        cruise: leg.cruise,
        legIndex: leg.legIndex,
        dep: leg.dep,
        arr: leg.arr,
        method: leg.method,
        worstDeltaDeg: leg.worstDeltaDeg,
        kinkCount: leg.kinks.length,
      },
    };
  }).filter(Boolean),
};

const kinks = {
  type: 'FeatureCollection',
  features: audit.results.flatMap((leg) =>
    leg.kinks.map((k) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: k.at },
      properties: {
        cruise: leg.cruise,
        leg: `${leg.dep} → ${leg.arr}`,
        method: leg.method,
        deltaDeg: k.deltaDeg,
        prevSegKm: k.prevSegKm,
        nextSegKm: k.nextSegKm,
        // Marker color: red for severe (>= 130°), orange (>= 110°), yellow (>= 90°).
        'marker-color':
          k.deltaDeg >= 130 ? '#dc2626' : k.deltaDeg >= 110 ? '#f59e0b' : '#facc15',
        'marker-size':
          k.deltaDeg >= 130 ? 'large' : k.deltaDeg >= 110 ? 'medium' : 'small',
      },
    })),
  ),
};

fs.writeFileSync(path.resolve(__dirname, 'routes.geojson'), JSON.stringify(routes, null, 2));
fs.writeFileSync(path.resolve(__dirname, 'kinks.geojson'), JSON.stringify(kinks, null, 2));

console.log(`Routes:  ${routes.features.length}`);
console.log(`Kinks:   ${kinks.features.length}`);
console.log(`Output:  tools/route-audit/{routes,kinks}.geojson`);
