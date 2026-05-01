/**
 * Shared loaders for the routing-strategy harness — ports CSV and the
 * fine 0.1° land mask. Avoids each strategy re-loading these on every
 * call.
 */
import fs from 'fs';
import path from 'path';
import {
  MASK_COLS,
  MASK_ROWS,
  cellIndex,
  getBit,
  latToRow,
  lonToCol,
} from '../../../backend/src/shared/geo/landMaskGrid';
import type { Port } from './types';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PORTS_CSV = path.resolve(ROOT, 'backend', 'src', 'seedData', 'ports.csv');
const FINE_MASK = path.resolve(ROOT, 'backend', 'data', 'land-mask-0.1deg.bin');

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

let portsByName: Map<string, Port> | null = null;

export function loadPorts(): Map<string, Port> {
  if (portsByName !== null) return portsByName;
  const raw = fs.readFileSync(PORTS_CSV, 'utf8');
  const rows = parseCsv(raw);
  const map = new Map<string, Port>();
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
    map.set(port.name.toLowerCase(), port);
    if (port.city && !map.has(port.city.toLowerCase())) {
      map.set(port.city.toLowerCase(), port);
    }
  });
  portsByName = map;
  return map;
}

let fineMask: Uint8Array | null = null;

export function loadFineMaskSync(): Uint8Array {
  if (fineMask !== null) return fineMask;
  const buf = fs.readFileSync(FINE_MASK);
  fineMask = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  return fineMask;
}

export function makeIsLand(): (lat: number, lon: number) => boolean {
  const bytes = loadFineMaskSync();
  return (lat, lon) => {
    if (lat < -90 || lat > 90) return false;
    const row = latToRow(lat);
    const col = lonToCol(lon);
    const c = ((col % MASK_COLS) + MASK_COLS) % MASK_COLS;
    if (row < 0 || row >= MASK_ROWS) return false;
    return getBit(bytes, cellIndex(row, c)) === 1;
  };
}

export const DEMO_CRUISES: ReadonlyArray<{ id: string; ports: ReadonlyArray<string> }> = [
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

export interface DemoLeg {
  readonly cruise: string;
  readonly legIndex: number;
  readonly dep: Port;
  readonly arr: Port;
}

export function buildDemoLegs(): { legs: DemoLeg[]; missing: string[] } {
  const ports = loadPorts();
  const legs: DemoLeg[] = [];
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
      legs.push({ cruise: cruise.id, legIndex: i, dep, arr });
    }
  }
  return { legs, missing: [...missing] };
}
