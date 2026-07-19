/**
 * generate-airline-catalog.ts — regenerates the frontend's airline lookup
 * catalogue from the DB seed builder, sourced from
 * backend/data/openflights/airlines.dat (via buildAirlineSeed).
 *
 * Why this exists (issue #178): the frontend cannot import backend
 * TypeScript modules directly (they build and deploy as two separate
 * packages), so frontend/src/lib/airlineUtils.ts used to carry its own
 * hand-typed copy of the IATA map. That copy had already drifted — ~60
 * entries vs. the backend's 148, and it never had ICAO codes at all, which
 * is what caused issue #178 (ICAO codes like "DLH"/"EWG" rendering raw
 * instead of resolving to "Lufthansa"/"Eurowings").
 *
 * The catalogue later grew beyond the hand-curated AIRLINES list: the DB is
 * now seeded from buildAirlineSeed(airlines.dat) — OpenFlights data unioned
 * with the curated AIRLINES list, with curated rows winning on a shared
 * IATA. This script emits a generated, DO-NOT-EDIT mirror of that same seed
 * (iata + icao + name) that frontend/src/lib/airlineUtils.ts derives all of
 * its lookup maps from, so the vendored frontend copy always matches the
 * table. Re-run this whenever backend/data/openflights/airlines.dat or the
 * curated backend/src/data/airlines.ts changes:
 *
 *   cd backend && npx tsx scripts/generate-airline-catalog.ts
 */

import { promises as fs, readFileSync } from 'fs';
import path from 'path';
import { buildAirlineSeed } from '../src/data/openflights/buildAirlineSeed';

export interface Airline {
  iata: string;
  icao?: string;
  name: string;
}

const OUTPUT_PATH = path.join(
  __dirname,
  '../../frontend/src/lib/generated/airlineCatalog.ts',
);

const AIRLINES_DAT_PATH = path.join(__dirname, '../data/openflights/airlines.dat');

/**
 * Loads the airline seed (OpenFlights ∪ curated AIRLINES, IATA-keyed) and
 * maps it to the flat shape the catalogue generator emits.
 */
export function loadSeed(): Airline[] {
  const raw = readFileSync(AIRLINES_DAT_PATH, 'utf-8');
  return buildAirlineSeed(raw).map((r) => ({
    iata: r.iata,
    icao: r.icao ?? undefined,
    name: r.name,
  }));
}

/**
 * Pure function that generates the airline catalogue contents.
 * This is exported for testing purposes — ensures the test uses the
 * exact same logic as the CLI script.
 */
export function generateAirlineCatalogContents(airlines: Airline[]): string {
  const header = `/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND.
 *
 * Mirrors the DB airline seed (buildAirlineSeed over
 * backend/data/openflights/airlines.dat, unioned with the curated
 * backend/src/data/airlines.ts). Regenerate with:
 *
 *   cd backend && npx tsx scripts/generate-airline-catalog.ts
 *
 * See backend/scripts/generate-airline-catalog.ts for details.
 */

export interface AirlineCatalogEntry {
  iata: string;
  icao?: string;
  name: string;
}

export const AIRLINE_CATALOG: AirlineCatalogEntry[] = [
`;

  const rows = airlines.map((a) => {
    const icaoPart = a.icao ? ` icao: ${JSON.stringify(a.icao)},` : '';
    return `  { iata: ${JSON.stringify(a.iata)},${icaoPart} name: ${JSON.stringify(a.name)} },`;
  });

  const footer = `];\n`;

  return header + rows.join('\n') + '\n' + footer;
}

async function main(): Promise<void> {
  const airlines = loadSeed();
  const contents = generateAirlineCatalogContents(airlines);

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, contents, 'utf-8');
  console.log(`Wrote ${airlines.length} airline entries to ${OUTPUT_PATH}`);
}

// Only run the generator (which WRITES OUTPUT_PATH) when this file is executed
// directly as a CLI — e.g. `npm run generate:airline-catalog`. Without this
// guard, importing anything from this module (the dataIntegrity drift-guard
// test imports generateAirlineCatalogContents) fired main() as a load-time
// side effect, rewriting the committed frontend catalogue mid-test-run. That
// async write raced the drift guard's synchronous compare and made the suite
// fail intermittently depending on suite ordering (CRLF churn on Windows).
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
