import { AIRCRAFT_TYPES } from "../aircraftTypes";
import { parsePlanesDat } from "./parseOpenFlights";

export interface AircraftSeedRow {
  icao: string;
  name: string;
}

const ICAO_RE = /^[A-Z0-9]{2,4}$/;

/**
 * Build the aircraft seed: OpenFlights planes.dat UNIONed with the curated
 * AIRCRAFT_TYPES, merged on ICAO. Curated wins on conflict (it encodes the
 * exact display names the app resolves to). Rows without a valid 2-4 char ICAO
 * are dropped (they cannot key the unique table).
 */
export function buildAircraftSeed(planesRaw: string): AircraftSeedRow[] {
  const byIcao = new Map<string, AircraftSeedRow>();

  for (const p of parsePlanesDat(planesRaw)) {
    if (!p.icao) continue;
    const icao = p.icao.toUpperCase();
    if (!ICAO_RE.test(icao)) continue;
    if (!byIcao.has(icao)) byIcao.set(icao, { icao, name: p.name });
  }

  for (const t of AIRCRAFT_TYPES) {
    const icao = t.icao.toUpperCase();
    if (!ICAO_RE.test(icao)) continue; // curated already cleaned in Task 2
    byIcao.set(icao, { icao, name: t.name }); // curated wins
  }

  return Array.from(byIcao.values());
}
