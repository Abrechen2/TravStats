import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockFindMany = jest.fn();

jest.mock('../../db', () => ({
  prisma: { airport: { findMany: mockFindMany } },
}));

import { getCachedAirport, getCachedAirports, clearAirportCache } from '../airportCache';

/**
 * Issue #240. A freshly seeded catalogue holds ~110 IATA codes on more than
 * one row — MUC is both Munich Airport and Flughafen München-Riem, closed
 * since 1992.
 *
 * Those duplicates are DELIBERATE. The composite uniqueness on
 * `(iata, isClosed)` exists so a closed airport stays searchable under the
 * code people remember it by (TXL, THF, MUC-Riem). Measured on a fresh seed:
 * all 110 are active+closed pairs and NONE has two active rows, so the
 * ambiguity the issue feared cannot arise from the seed.
 *
 * What makes that safe is that every resolution path sorts by
 * `compareAirportAuthority` before taking the first row. The comparator itself
 * is unit-tested next door — but nothing pinned that the CALL SITES still use
 * it. Delete a sort and those tests stay green while flights quietly acquire a
 * closed airfield's coordinates, country and timezone.
 */
const munichActive = {
  iata: 'MUC',
  icao: 'EDDM',
  name: 'Munich Airport',
  city: 'Munich',
  country: 'Germany',
  lat: 48.3538,
  lon: 11.7861,
  altitude: 448,
  timezone: 'Europe/Berlin',
  isClosed: false,
};

const munichRiemClosed = {
  iata: 'MUC',
  icao: 'EDDM',
  name: 'Flughafen München-Riem',
  city: 'Munich',
  country: 'Germany',
  lat: 48.1342,
  lon: 11.6947,
  altitude: 1738,
  timezone: 'Europe/Berlin',
  isClosed: true,
};

describe('IATA collisions resolve to the ACTIVE airport (#240)', () => {
  beforeEach(() => {
    mockFindMany.mockReset();
    clearAirportCache();
  });

  it('getCachedAirport returns the open airport, whatever order the DB gives', async () => {
    // Closed row FIRST — the query has no ORDER BY, so this is a shape the
    // database is free to return.
    mockFindMany.mockResolvedValue([munichRiemClosed, munichActive]);

    const airport = await getCachedAirport('MUC');

    expect(airport?.name).toBe('Munich Airport');
    // The consequence that matters: a flight stamped with these coordinates
    // must not land at a field that shut in 1992.
    expect(airport?.lat).toBeCloseTo(48.3538, 4);
  });

  it('getCachedAirports gives the shared code to the open airport in a batch', async () => {
    mockFindMany.mockResolvedValue([munichRiemClosed, munichActive]);

    const map = await getCachedAirports(['MUC']);

    expect(map.get('MUC')?.name).toBe('Munich Airport');
  });

  it('still resolves a code held only by a closed airport', async () => {
    // The other half of the deal: closed airports stay searchable, which is
    // the whole reason the duplicate rows exist.
    mockFindMany.mockResolvedValue([{ ...munichRiemClosed, iata: 'THF', name: 'Berlin Tempelhof' }]);

    const airport = await getCachedAirport('THF');

    expect(airport?.name).toBe('Berlin Tempelhof');
  });
});
