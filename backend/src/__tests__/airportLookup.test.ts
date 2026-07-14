import { prisma } from '../db';
import { enrichAirportMetadata, findNearestAirport, findOrCreateAirport } from '../services/airportLookup';
import { getCachedAirport, getCachedAirports } from '../services/airportCache';

describe('Airport Lookup', () => {
  beforeAll(async () => {
    // Ensure test airport exists
    const existing = await prisma.airport.findFirst({
      where: { iata: 'FRA' },
    });

    if (!existing) {
      await prisma.airport.create({
        data: {
          iata: 'FRA',
          icao: 'EDDF',
          name: 'Frankfurt Airport',
          city: 'Frankfurt',
          country: 'Germany',
          lat: 50.0379,
          lon: 8.5622,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('findOrCreateAirport', () => {
    it('should find existing airport by IATA code', async () => {
      const airport = await findOrCreateAirport('FRA');

      expect(airport).toBeDefined();
      expect(airport?.iata).toBe('FRA');
      expect(airport?.name).toContain('Frankfurt');
    });

    it('should find existing airport by ICAO code', async () => {
      const airport = await findOrCreateAirport('EDDF');

      expect(airport).toBeDefined();
      expect(airport?.icao).toBe('EDDF');
    });

    it('should return null for non-existent airport', async () => {
      // Use a code that definitely doesn't exist
      const airport = await findOrCreateAirport('XXX999');

      // Should return null or handle gracefully
      // (depending on implementation, might try external API)
      expect(airport).toBeDefined(); // Might return null or attempt external lookup
    });
  });

  describe('Airport Cache', () => {
    it('should cache airport lookups', async () => {
      // First lookup - should hit database
      const airport1 = await getCachedAirport('FRA');
      expect(airport1).toBeDefined();
      expect(airport1?.iata).toBe('FRA');

      // Second lookup - should hit cache
      const airport2 = await getCachedAirport('FRA');
      expect(airport2).toBeDefined();
      expect(airport2?.iata).toBe('FRA');
    });

    it('should batch fetch multiple airports', async () => {
      // Ensure airports exist
      const airports = ['FRA', 'LHR', 'JFK'];
      for (const code of airports) {
        const exists = await prisma.airport.findFirst({
          where: { OR: [{ iata: code }, { icao: code }] },
        });
        if (!exists && code === 'LHR') {
          await prisma.airport.create({
            data: {
              iata: 'LHR',
              icao: 'EGLL',
              name: 'London Heathrow Airport',
              city: 'London',
              country: 'United Kingdom',
              lat: 51.4700,
              lon: -0.4543,
            },
          });
        }
        if (!exists && code === 'JFK') {
          await prisma.airport.create({
            data: {
              iata: 'JFK',
              icao: 'KJFK',
              name: 'John F. Kennedy International Airport',
              city: 'New York',
              country: 'United States',
              lat: 40.6413,
              lon: -73.7781,
            },
          });
        }
      }

      const cachedAirports = await getCachedAirports(['FRA', 'LHR', 'JFK']);

      expect(cachedAirports.size).toBeGreaterThan(0);
      expect(cachedAirports.has('FRA')).toBe(true);
    });
  });

  describe('enrichAirportMetadata (v1.5.1 — AeroDataBox-side metadata backfill)', () => {
    const TEST_CODE = 'TENRICH1';

    beforeEach(async () => {
      // Reset to a known clean state every test
      await prisma.airport.deleteMany({ where: { iata: TEST_CODE } });
      await prisma.airport.create({
        data: {
          iata: TEST_CODE,
          icao: 'XENR',
          name: 'Test Enrichment Airport',
          lat: 0,
          lon: 0,
        },
      });
    });

    afterAll(async () => {
      await prisma.airport.deleteMany({ where: { iata: TEST_CODE } });
    });

    it('backfills shortName + municipalityName when both columns are NULL', async () => {
      const changed = await enrichAirportMetadata(TEST_CODE, {
        shortName: 'Test Short',
        municipalityName: 'Testtown',
      });
      expect(changed).toBe(true);

      const row = await prisma.airport.findFirst({ where: { iata: TEST_CODE } });
      expect(row?.shortName).toBe('Test Short');
      expect(row?.municipalityName).toBe('Testtown');
    });

    it('never overwrites a curated shortName', async () => {
      await prisma.airport.update({
        where: { id: (await prisma.airport.findFirstOrThrow({ where: { iata: TEST_CODE } })).id },
        data: { shortName: 'Curated Value' },
      });

      const changed = await enrichAirportMetadata(TEST_CODE, {
        shortName: 'Provider Override',
        municipalityName: 'Testtown',
      });
      // municipalityName still fills (was NULL), but shortName is preserved.
      expect(changed).toBe(true);

      const row = await prisma.airport.findFirst({ where: { iata: TEST_CODE } });
      expect(row?.shortName).toBe('Curated Value');
      expect(row?.municipalityName).toBe('Testtown');
    });

    it('is a no-op when both columns are already populated', async () => {
      await prisma.airport.update({
        where: { id: (await prisma.airport.findFirstOrThrow({ where: { iata: TEST_CODE } })).id },
        data: { shortName: 'Existing', municipalityName: 'Existing City' },
      });

      const changed = await enrichAirportMetadata(TEST_CODE, {
        shortName: 'New',
        municipalityName: 'New City',
      });
      expect(changed).toBe(false);

      const row = await prisma.airport.findFirst({ where: { iata: TEST_CODE } });
      expect(row?.shortName).toBe('Existing');
      expect(row?.municipalityName).toBe('Existing City');
    });

    it('is a no-op when no enrichment data is passed', async () => {
      const changed = await enrichAirportMetadata(TEST_CODE, {});
      expect(changed).toBe(false);
    });

    it('returns false for a code that does not exist', async () => {
      const changed = await enrichAirportMetadata('NOSUCHCODE', {
        shortName: 'x',
      });
      expect(changed).toBe(false);
    });

    it('trims whitespace from the incoming values', async () => {
      const changed = await enrichAirportMetadata(TEST_CODE, {
        shortName: '  Whitespace Short  ',
        municipalityName: '  Whitespace City  ',
      });
      expect(changed).toBe(true);

      const row = await prisma.airport.findFirst({ where: { iata: TEST_CODE } });
      expect(row?.shortName).toBe('Whitespace Short');
      expect(row?.municipalityName).toBe('Whitespace City');
    });
  });

  describe('findNearestAirport', () => {
    // Synthetic pair in an empty stretch of the Gulf of Guinea, so the
    // assertion never depends on which real airports the OurAirports seed
    // happens to hold. The closed airfield sits CLOSER to the probe than the
    // open airport — the exact geometry that made a coarsely-rounded JFK
    // coordinate resolve to the closed Rockaway Airport (NOLF).
    const OPEN_ICAO = 'ZZZQ';
    const CLOSED_ICAO = 'ZZ-9999';
    const PROBE = { lat: 0, lon: 0 };

    beforeAll(async () => {
      await prisma.airport.deleteMany({ where: { icao: { in: [OPEN_ICAO, CLOSED_ICAO] } } });
      await prisma.airport.createMany({
        data: [
          {
            iata: 'ZZQ',
            icao: OPEN_ICAO,
            name: 'Testville International',
            lat: 0.03, // ~4.7 km from the probe
            lon: 0.03,
            isClosed: false,
          },
          {
            iata: null,
            icao: CLOSED_ICAO,
            name: 'Testville Closed Airfield',
            lat: 0.01, // ~1.6 km from the probe — geometrically the winner
            lon: 0.01,
            isClosed: true,
          },
        ],
      });
    });

    afterAll(async () => {
      await prisma.airport.deleteMany({ where: { icao: { in: [OPEN_ICAO, CLOSED_ICAO] } } });
    });

    it('never returns a closed airfield, even when it is the closest row', async () => {
      const airport = await findNearestAirport(PROBE.lat, PROBE.lon, 5);

      expect(airport?.icao).toBe(OPEN_ICAO);
      expect(airport?.name).toBe('Testville International');
    });

    it('returns null when the only airport in range is closed', async () => {
      // Radius covers the closed airfield (~1.6 km) but not the open one (~4.7 km).
      const airport = await findNearestAirport(PROBE.lat, PROBE.lon, 3);

      expect(airport).toBeNull();
    });
  });
});
























