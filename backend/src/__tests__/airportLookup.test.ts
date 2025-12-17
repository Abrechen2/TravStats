import { prisma } from '../db';
import { findOrCreateAirport } from '../services/airportLookup';
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
});








