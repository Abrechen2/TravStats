/**
 * Drift guard: ensures the generated frontend airline catalogue
 * (frontend/src/lib/generated/airlineCatalog.ts) is in sync with
 * the backend's single source of truth (backend/src/data/airlines.ts).
 *
 * Context: the previous hand-maintained copy drifted to 60 entries with
 * zero ICAO codes while the backend had 146 with ICAO. This test prevents
 * a repeat by failing loudly whenever someone edits airlines.ts but
 * forgets to regenerate.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { AIRLINES } from '../data/airlines';
import { generateAirlineCatalogContents } from '../../scripts/generate-airline-catalog';

describe('dataIntegrity: airline catalogue drift guard', () => {
  it('should match the committed frontend catalogue with the backend source', () => {
    // Generate what the catalogue SHOULD contain right now
    const expectedContents = generateAirlineCatalogContents(AIRLINES);

    // Read what is actually committed in the frontend
    const catalogPath = path.join(
      __dirname,
      '../../../frontend/src/lib/generated/airlineCatalog.ts',
    );
    let actualContents: string;
    try {
      actualContents = readFileSync(catalogPath, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `Generated catalogue not found at ${catalogPath}. ` +
            'Run: cd backend && npm run generate:airline-catalog',
        );
      }
      throw err;
    }

    // Compare
    if (actualContents !== expectedContents) {
      throw new Error(
        'The generated airline catalogue is out of sync.\n\n' +
          'The backend source (backend/src/data/airlines.ts) does not match ' +
          'the committed frontend file (frontend/src/lib/generated/airlineCatalog.ts).\n\n' +
          'Fix: Run the following and commit the result:\n' +
          '  cd backend && npm run generate:airline-catalog\n\n' +
          'Why: The previous hand-maintained copy drifted to 60 entries with zero ' +
          'ICAO codes while the backend had 146 with ICAO. ' +
          'This test prevents a repeat.',
      );
    }

    // Sanity check: ensure the catalogue has a reasonable number of entries
    expect(AIRLINES.length).toBeGreaterThan(100);
  });
});
