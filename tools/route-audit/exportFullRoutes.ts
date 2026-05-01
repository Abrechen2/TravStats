/**
 * Re-runs every demo leg and emits a single GeoJSON FeatureCollection
 * containing the FULL waypoint polyline per leg (LineString) plus the
 * kink anchors (Point) — paste into geojson.io for a complete picture.
 *
 * Run:  npx tsx tools/route-audit/exportFullRoutes.ts (from repo root)
 */
import fs from 'fs';
import path from 'path';
import { computeSchematicRoute } from '../../backend/src/services/schematicRouter';
import { haversineKm } from '../../backend/src/shared/geo/haversine';

interface Port {
  id: number;
  name: string;
  city: string;
  country: string;
  unlocode: string;
  lat: number;
  lon: number;
}

const PORTS_CSV = path.resolve(__dirname, '..', '..', 'backend', 'src', 'seedData', 'ports.csv');

const KINK_DEG = 90;

const DEMO_CRUISES: ReadonlyArray<{ id: string; ports: ReadonlyArray<string> }> = [
  { id: 'AIDAnova-Mittelmeer',
    ports: ['Barcelona', 'Palma de Mallorca', 'Civitavecchia', 'Naples', 'Marseille', 'Barcelona'] },
  { id: 'AIDAcosma-Nordland',
    ports: ['Hamburg', 'Bergen', 'Flåm', 'Geiranger', 'Ålesund', 'Oslo', 'Copenhagen', 'Hamburg'] },
  { id: 'AIDAprima-Ostsee',
    ports: ['Kiel', 'Copenhagen', 'Stockholm', 'Tallinn', 'Gdańsk', 'Kiel'] },
  { id: 'AIDAperla-Kanaren',
    ports: ['Las Palmas', 'Funchal', 'Lisbon', 'Málaga', 'Las Palmas'] },
  { id: 'AIDAmar-MittelmeerOst',
    ports: ['Athens (Piraeus)', 'Mykonos', 'Kuşadası', 'Istanbul', 'Santorini', 'Athens (Piraeus)'] },
  { id: 'AIDAbella-Adria',
    ports: ['Venice', 'Dubrovnik', 'Naples', 'Civitavecchia', 'Genoa', 'Venice'] },
  { id: 'MeinSchiff1-Karibik',
    ports: ['Miami', 'Nassau', 'San Juan', 'St. Thomas', 'Bridgetown', 'Cozumel', 'Miami'] },
  { id: 'MeinSchiff2-Transatlantik',
    ports: ['Hamburg', 'Funchal', 'Nassau', 'Miami'] },
  { id: 'MeinSchiff3-MittelmeerWest',
    ports: ['Palma de Mallorca', 'Valencia', 'Marseille', 'Genoa', 'Nice', 'Palma de Mallorca'] },
  { id: 'MeinSchiff5-Norwegen',
    ports: ['Kiel', 'Bergen', 'Geiranger', 'Ålesund', 'Oslo', 'Kiel'] },
  { id: 'MeinSchiff7-OstseePremium',
    ports: ['Kiel', 'Copenhagen', 'Stockholm', 'Helsinki', 'Tallinn', 'Kiel'] },
  { id: 'MSCWorldEuropa-Mittelmeer',
    ports: ['Genoa', 'Civitavecchia', 'Barcelona', 'Marseille', 'Genoa'] },
  { id: 'MSCGrandiosa-Nordeuropa',
    ports: ['Hamburg', 'Southampton', 'Amsterdam', 'Rotterdam', 'Bremerhaven', 'Hamburg'] },
  { id: 'CostaToscana-MittelmeerWest',
    ports: ['Barcelona', 'Marseille', 'Genoa', 'Civitavecchia', 'Naples', 'Palma de Mallorca', 'Barcelona'] },
  { id: 'CostaSmeralda-Mittelmeer',
    ports: ['Civitavecchia', 'Naples', 'Barcelona', 'Marseille', 'Genoa', 'Civitavecchia'] },
  { id: 'WonderOfTheSeas-KaribikOst',
    ports: ['Fort Lauderdale', 'San Juan', 'St. Thomas', 'Nassau', 'Fort Lauderdale'] },
  { id: 'IconOfTheSeas-KaribikWest',
    ports: ['Miami', 'Cozumel', 'Nassau', 'Port Canaveral', 'Miami'] },
  { id: 'CarnivalCelebration-Karibik',
    ports: ['Miami', 'Nassau', 'San Juan', 'St. Thomas', 'Miami'] },
  { id: 'NorwegianPrima-Alaska',
    ports: ['Seward', 'Juneau', 'Skagway', 'Ketchikan', 'Vancouver'] },
  { id: 'Europa2-Panama',
    ports: ['Fort Lauderdale', 'Nassau', 'Panama Canal (Colón)', 'Vancouver'] },
  { id: 'AIDAluna-Kurzreise',
    ports: ['Kiel', 'Copenhagen', 'Kiel'] },
];

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h.trim()] = (cells[i] ?? '').trim(); });
    return row;
  });
}

function loadPorts(): Map<string, Port> {
  const raw = fs.readFileSync(PORTS_CSV, 'utf8');
  const rows = parseCsv(raw);
  const byKey = new Map<string, Port>();
  rows.forEach((row, i) => {
    const port: Port = {
      id: i + 1,
      name: row.name,
      city: row.city,
      country: row.country,
      unlocode: row.unlocode,
      lat: Number.parseFloat(row.lat),
      lon: Number.parseFloat(row.lon),
    };
    byKey.set(port.name.toLowerCase(), port);
    if (port.city && !byKey.has(port.city.toLowerCase())) byKey.set(port.city.toLowerCase(), port);
  });
  return byKey;
}

function bearingDeg(a: readonly [number, number], b: readonly [number, number]): number {
  const [lon1, lat1] = a.map((v) => (v * Math.PI) / 180) as [number, number];
  const [lon2, lat2] = b.map((v) => (v * Math.PI) / 180) as [number, number];
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angularDelta(b1: number, b2: number): number {
  const d = Math.abs(b1 - b2) % 360;
  return d > 180 ? 360 - d : d;
}

interface Feature {
  type: 'Feature';
  geometry: { type: 'LineString' | 'Point'; coordinates: unknown };
  properties: Record<string, unknown>;
}

async function main(): Promise<void> {
  const ports = loadPorts();
  const features: Feature[] = [];
  for (const cruise of DEMO_CRUISES) {
    for (let i = 0; i < cruise.ports.length - 1; i++) {
      const dep = ports.get(cruise.ports[i].toLowerCase());
      const arr = ports.get(cruise.ports[i + 1].toLowerCase());
      if (!dep || !arr) continue;
      const route = await computeSchematicRoute(dep, arr);
      const wpts = route.waypoints;
      let kinkCount = 0;
      let worstDelta = 0;
      for (let j = 1; j < wpts.length - 1; j++) {
        const delta = angularDelta(bearingDeg(wpts[j - 1], wpts[j]), bearingDeg(wpts[j], wpts[j + 1]));
        if (delta >= KINK_DEG) {
          kinkCount++;
          worstDelta = Math.max(worstDelta, delta);
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: wpts[j] },
            properties: {
              kind: 'kink',
              cruise: cruise.id,
              leg: `${dep.name} → ${arr.name}`,
              method: route.method,
              deltaDeg: Math.round(delta * 10) / 10,
              'marker-color': delta >= 130 ? '#dc2626' : delta >= 110 ? '#f59e0b' : '#facc15',
              'marker-size': delta >= 130 ? 'large' : delta >= 110 ? 'medium' : 'small',
            },
          });
        }
      }
      const stroke =
        worstDelta >= 130 ? '#dc2626' : worstDelta >= 110 ? '#f59e0b' : worstDelta >= 90 ? '#facc15' : '#22c55e';
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: wpts },
        properties: {
          kind: 'route',
          cruise: cruise.id,
          legIndex: i,
          leg: `${dep.name} → ${arr.name}`,
          method: route.method,
          waypointCount: wpts.length,
          chordKm: Math.round(haversineKm(dep, arr)),
          kinkCount,
          worstDelta: Math.round(worstDelta * 10) / 10,
          stroke,
          'stroke-width': worstDelta >= 130 ? 4 : 2,
          'stroke-opacity': 0.85,
        },
      });
    }
  }
  const fc = { type: 'FeatureCollection', features };
  const out = path.resolve(__dirname, 'full-routes.geojson');
  fs.writeFileSync(out, JSON.stringify(fc, null, 2));
  console.log(`Wrote ${features.length} features → ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
