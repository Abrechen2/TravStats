/**
 * Demo-route audit: runs every leg of every demo cruise template through
 * `computeSchematicRoute` and reports per-leg kink severity.
 *
 * Run:
 *   cd backend
 *   DATABASE_URL=... npx tsx ../tools/route-audit/auditDemoRoutes.ts
 *
 * The script does NOT touch the database; it builds port objects from the
 * seed CSV. Output: console table + tools/route-audit/audit.json.
 */
import fs from 'fs';
import path from 'path';
import { computeSchematicRoute } from '../../backend/src/services/schematicRouter';
import { haversineKm } from '../../backend/src/shared/geo/haversine';

/** Minimal CSV reader for the seed ports file. The schema is fixed and
 * never contains embedded commas or quotes, so a simple split is safe. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h.trim()] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

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
const OUTPUT_JSON = path.resolve(__dirname, 'audit.json');

/** Bearing reversal threshold: ≥ this many degrees between consecutive
 * segments counts as a kink. 90° = a hard right-angle turn; >120° = the
 * route doubles back. Real cruise paths around peninsulas turn at
 * 30°-60° max once smoothed. */
const KINK_DEG = 90;

/** Demo cruise leg sequences, copied verbatim from seedDemoAccount.ts
 * CRUISE_TEMPLATES (consecutive port pairs only — sea days collapse out). */
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
    if (port.city && !byKey.has(port.city.toLowerCase())) {
      byKey.set(port.city.toLowerCase(), port);
    }
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

async function auditLeg(
  cruise: string,
  legIndex: number,
  dep: Port,
  arr: Port,
): Promise<LegResult> {
  const route = await computeSchematicRoute(dep, arr);
  const wpts = route.waypoints;
  const kinks: Kink[] = [];
  let polylineKm = 0;
  for (let i = 1; i < wpts.length; i++) {
    polylineKm += haversineKm(
      { lat: wpts[i - 1][1], lon: wpts[i - 1][0] },
      { lat: wpts[i][1], lon: wpts[i][0] },
    );
  }
  for (let i = 1; i < wpts.length - 1; i++) {
    const b1 = bearingDeg(wpts[i - 1], wpts[i]);
    const b2 = bearingDeg(wpts[i], wpts[i + 1]);
    const delta = angularDelta(b1, b2);
    if (delta >= KINK_DEG) {
      kinks.push({
        index: i,
        at: wpts[i],
        prev: wpts[i - 1],
        next: wpts[i + 1],
        deltaDeg: Math.round(delta * 10) / 10,
        prevSegKm:
          Math.round(
            haversineKm(
              { lat: wpts[i - 1][1], lon: wpts[i - 1][0] },
              { lat: wpts[i][1], lon: wpts[i][0] },
            ) * 10,
          ) / 10,
        nextSegKm:
          Math.round(
            haversineKm(
              { lat: wpts[i][1], lon: wpts[i][0] },
              { lat: wpts[i + 1][1], lon: wpts[i + 1][0] },
            ) * 10,
          ) / 10,
      });
    }
  }
  const worst = kinks.reduce((acc, k) => Math.max(acc, k.deltaDeg), 0);
  return {
    cruise,
    legIndex,
    dep: dep.name,
    arr: arr.name,
    method: route.method,
    routed: route.routed,
    waypointCount: wpts.length,
    chordKm: Math.round(haversineKm(dep, arr)),
    polylineKm: Math.round(polylineKm),
    kinks,
    worstDeltaDeg: worst,
  };
}

async function main(): Promise<void> {
  const ports = loadPorts();
  const results: LegResult[] = [];
  const missing = new Set<string>();
  for (const cruise of DEMO_CRUISES) {
    for (let i = 0; i < cruise.ports.length - 1; i++) {
      const dep = ports.get(cruise.ports[i].toLowerCase());
      const arr = ports.get(cruise.ports[i + 1].toLowerCase());
      if (!dep) {
        missing.add(cruise.ports[i]);
        continue;
      }
      if (!arr) {
        missing.add(cruise.ports[i + 1]);
        continue;
      }
      const r = await auditLeg(cruise.id, i, dep, arr);
      results.push(r);
    }
  }
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify({ kinkThresholdDeg: KINK_DEG, results, missing: [...missing] }, null, 2));
  const withKinks = results.filter((r) => r.kinks.length > 0);
  const total = results.length;
  console.log(`\n=== Demo-route audit (${total} legs) ===`);
  console.log(`  Kinks ≥ ${KINK_DEG}°: ${withKinks.length} legs (${Math.round((withKinks.length / total) * 100)} %)`);
  console.log(`  Missing ports: ${[...missing].join(', ') || '(none)'}`);
  const byMethod = new Map<string, number>();
  for (const r of results) byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + 1);
  console.log(`  Method distribution: ${[...byMethod].map(([m, n]) => `${m}=${n}`).join(', ')}`);
  console.log('\n--- Legs with kinks ---');
  withKinks
    .slice()
    .sort((a, b) => b.worstDeltaDeg - a.worstDeltaDeg)
    .forEach((r) => {
      console.log(
        `  [${r.method.padEnd(15)}] ${r.cruise} #${r.legIndex} ${r.dep} → ${r.arr}: ${r.kinks.length} kink(s), worst ${r.worstDeltaDeg}°`,
      );
      r.kinks.forEach((k) =>
        console.log(`      idx ${k.index} @ [${k.at[0].toFixed(2)}, ${k.at[1].toFixed(2)}] Δ${k.deltaDeg}° (${k.prevSegKm}km→${k.nextSegKm}km)`),
      );
    });
  console.log(`\nFull JSON: ${OUTPUT_JSON}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
