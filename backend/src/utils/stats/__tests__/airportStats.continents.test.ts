/**
 * forgejo#87 — the airport statistics carried their own six-bucket continent
 * table (no Antarctica, "Other" for anything unlisted) while the passport
 * counted seven through `utils/continents.ts`. The tile said "6/ 6", its
 * caption "of the 7", the passport "6/7". One resolver, one denominator.
 */
import { calculateAirportStats } from '../airportStats';
import { CONTINENTS } from '../../continents';
import type { FlightData } from '../types';

const AIRPORT_DB: Record<
  string,
  { iata: string | null; icao: string | null; name: string; altitude: number; lat: number; lon: number; country: string; timezone: string }
> = {
  FRA: { iata: 'FRA', icao: 'EDDF', name: 'Frankfurt', altitude: 111, lat: 50.0379, lon: 8.5622, country: 'DE', timezone: 'Europe/Berlin' },
  // McMurdo Station — Antarctica, which the old table could not name.
  NZIR: { iata: null, icao: 'NZIR', name: 'McMurdo', altitude: 0, lat: -77.8539, lon: 166.4694, country: 'AQ', timezone: 'Antarctica/McMurdo' },
  // Bermuda — not in the old table either, so it read "Other" and once made
  // the tile say "7 of 6".
  BDA: { iata: 'BDA', icao: 'TXKF', name: 'Bermuda', altitude: 4, lat: 32.364, lon: -64.6787, country: 'BM', timezone: 'Atlantic/Bermuda' },
};

jest.mock('../../../services/airportCache', () => ({
  getCachedAirports: jest.fn(async (codes: string[]) => {
    const map = new Map<string, unknown>();
    for (const code of codes) {
      const upper = code.toUpperCase();
      if (AIRPORT_DB[upper]) map.set(upper, AIRPORT_DB[upper]);
    }
    return map;
  }),
}));

function flight(dep: keyof typeof AIRPORT_DB, arr: keyof typeof AIRPORT_DB, id: string): FlightData {
  const d = AIRPORT_DB[dep];
  const a = AIRPORT_DB[arr];
  return {
    id,
    status: 'flown',
    depIata: d.iata,
    depIcao: d.icao,
    arrIata: a.iata,
    arrIcao: a.icao,
    depLat: d.lat,
    depLon: d.lon,
    arrLat: a.lat,
    arrLon: a.lon,
    departureTime: new Date('2026-01-10T08:00:00Z'),
    arrivalTime: new Date('2026-01-10T20:00:00Z'),
    airline: 'Test',
    seatClass: null,
    category: null,
    price: null,
    taxes: null,
    fees: null,
    currency: null,
    priceBase: null,
    fxBaseCurrency: null,
    bookingId: null,
    booking: null,
  } as unknown as FlightData;
}

describe('calculateAirportStats — continents come from the one shared table', () => {
  it('credits Antarctica for a flight to McMurdo instead of filing it under Other', async () => {
    const stats = await calculateAirportStats([flight('FRA', 'NZIR', 'f1')], []);

    expect(stats.continentDistribution).toEqual({ Europe: 1, Antarctica: 1 });
    expect(stats.continentCount).toBe(2);
  });

  it('places Bermuda in North America — nothing a real country resolves to is "Other"', async () => {
    const stats = await calculateAirportStats([flight('FRA', 'BDA', 'f2')], []);

    expect(stats.continentDistribution).toEqual({ Europe: 1, 'North America': 1 });
    expect(stats.continentDistribution.Other).toBeUndefined();
  });

  it('reports the same denominator the passport uses', async () => {
    const stats = await calculateAirportStats([flight('FRA', 'NZIR', 'f3')], []);

    expect(stats.continentTotal).toBe(CONTINENTS.length);
    expect(stats.continentTotal).toBe(7);
  });
});
