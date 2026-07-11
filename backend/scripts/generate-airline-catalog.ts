/**
 * generate-airline-catalog.ts — regenerates the frontend's airline lookup
 * catalogue from the single source of truth at backend/src/data/airlines.ts.
 *
 * Why this exists (issue #178): the frontend cannot import backend
 * TypeScript modules directly (they build and deploy as two separate
 * packages), so frontend/src/lib/airlineUtils.ts used to carry its own
 * hand-typed copy of the IATA map. That copy had already drifted — ~60
 * entries vs. the backend's 148, and it never had ICAO codes at all, which
 * is what caused issue #178 (ICAO codes like "DLH"/"EWG" rendering raw
 * instead of resolving to "Lufthansa"/"Eurowings").
 *
 * Instead of hand-copying entries again, this script emits a generated,
 * DO-NOT-EDIT mirror of the full AIRLINES catalogue (iata + icao + name)
 * that frontend/src/lib/airlineUtils.ts derives all of its lookup maps
 * from. Re-run this whenever backend/src/data/airlines.ts changes:
 *
 *   cd backend && npx tsx scripts/generate-airline-catalog.ts
 */

import { promises as fs } from 'fs';
import path from 'path';
import { AIRLINES, type Airline } from '../src/data/airlines';

const OUTPUT_PATH = path.join(
  __dirname,
  '../../frontend/src/lib/generated/airlineCatalog.ts',
);

/**
 * Pure function that generates the airline catalogue contents.
 * This is exported for testing purposes — ensures the test uses the
 * exact same logic as the CLI script.
 */
export function generateAirlineCatalogContents(airlines: Airline[]): string {
  const header = `/**
 * AUTO-GENERATED — DO NOT EDIT BY HAND.
 *
 * Mirrors backend/src/data/airlines.ts (the single source of truth for the
 * airline catalogue). Regenerate with:
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
  const contents = generateAirlineCatalogContents(AIRLINES);

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, contents, 'utf-8');
  console.log(`Wrote ${AIRLINES.length} airline entries to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
