import { calculateUniqueStats } from '../utils/statsCalculator';
import type { FlightData } from '../utils/statsCalculator';

// The airport cache is hit for timezone/country metadata. For layover tests
// we don't need that data, so mocking the module keeps the test independent
// of the real PostgreSQL + seeded airport table.
jest.mock('../services/airportCache', () => ({
  getCachedAirports: jest.fn(async () => new Map()),
}));

function flight(partial: Partial<FlightData> & { depIata: string; arrIata: string; departureTime: Date; arrivalTime: Date }): FlightData {
  return {
    id: `f-${partial.depIata}-${partial.arrIata}-${partial.departureTime.toISOString()}`,
    depLat: 0,
    depLon: 0,
    arrLat: 0,
    arrLon: 0,
    depIcao: null,
    arrIcao: null,
    airline: 'Test',
    aircraft: null,
    status: 'flown',
    price: null,
    taxes: null,
    fees: null,
    category: null,
    seatClass: null,
    createdAt: new Date(),
    ...partial,
  };
}

describe('calculateUniqueStats — layover handling', () => {
  it('caps layovers at 24 hours so weeks at home do not count', () => {
    // User flies MUC→FRA, then 5.5 years pass (living at home), then FRA→MUC.
    // Without a cap the gap between MUC→FRA arrival and next MUC departure
    // counts as a "layover" of ~48000 hours (the bug).
    const flights: FlightData[] = [
      flight({
        depIata: 'MUC',
        arrIata: 'FRA',
        departureTime: new Date('2020-01-10T08:00:00Z'),
        arrivalTime: new Date('2020-01-10T09:00:00Z'),
      }),
      flight({
        depIata: 'FRA',
        arrIata: 'MUC',
        departureTime: new Date('2026-04-14T18:00:00Z'),
        arrivalTime: new Date('2026-04-14T19:00:00Z'),
      }),
    ];

    const stats = awaitable(calculateUniqueStats(flights, []));
    return stats.then((result) => {
      expect(result.longestLayover).toBeNull();
    });
  });

  it('reports a realistic layover within the cap', () => {
    // Two-leg trip: MUC→FRA, 3h connection, FRA→LHR.
    const flights: FlightData[] = [
      flight({
        depIata: 'MUC',
        arrIata: 'FRA',
        departureTime: new Date('2026-06-01T08:00:00Z'),
        arrivalTime: new Date('2026-06-01T09:00:00Z'),
      }),
      flight({
        depIata: 'FRA',
        arrIata: 'LHR',
        departureTime: new Date('2026-06-01T12:00:00Z'),
        arrivalTime: new Date('2026-06-01T13:00:00Z'),
      }),
    ];

    return calculateUniqueStats(flights, []).then((result) => {
      expect(result.longestLayover).not.toBeNull();
      expect(result.longestLayover?.from).toBe('FRA');
      expect(result.longestLayover?.hours).toBeCloseTo(3, 1);
      expect(result.shortestLayover?.hours).toBeCloseTo(3, 1);
    });
  });

  it('excludes layovers at the home airport active on that date', () => {
    // User lives in MUC in 2020, moves to BER in 2024.
    const homeHistory = [
      { iata: 'MUC', fromDate: '2018-01-01', toDate: '2024-06-01' },
      { iata: 'BER', fromDate: '2024-06-01', toDate: null },
    ];

    // 2020-03: FRA→MUC arrival, then 12h later MUC→LHR. MUC was home → skip.
    const flights: FlightData[] = [
      flight({
        depIata: 'FRA',
        arrIata: 'MUC',
        departureTime: new Date('2020-03-10T06:00:00Z'),
        arrivalTime: new Date('2020-03-10T07:00:00Z'),
      }),
      flight({
        depIata: 'MUC',
        arrIata: 'LHR',
        departureTime: new Date('2020-03-10T19:00:00Z'),
        arrivalTime: new Date('2020-03-10T20:00:00Z'),
      }),
    ];

    return calculateUniqueStats(flights, homeHistory).then((result) => {
      expect(result.longestLayover).toBeNull();
      expect(result.shortestLayover).toBeNull();
    });
  });

  it('includes layovers at the OLD home airport after a move', () => {
    // After moving to BER in 2024-06, a stop in MUC is no longer home and
    // should count as a regular layover.
    const homeHistory = [
      { iata: 'MUC', fromDate: '2018-01-01', toDate: '2024-06-01' },
      { iata: 'BER', fromDate: '2024-06-01', toDate: null },
    ];

    const flights: FlightData[] = [
      flight({
        depIata: 'FRA',
        arrIata: 'MUC',
        departureTime: new Date('2025-09-10T06:00:00Z'),
        arrivalTime: new Date('2025-09-10T07:00:00Z'),
      }),
      flight({
        depIata: 'MUC',
        arrIata: 'LHR',
        departureTime: new Date('2025-09-10T11:00:00Z'),
        arrivalTime: new Date('2025-09-10T12:00:00Z'),
      }),
    ];

    return calculateUniqueStats(flights, homeHistory).then((result) => {
      expect(result.longestLayover).not.toBeNull();
      expect(result.longestLayover?.from).toBe('MUC');
      expect(result.longestLayover?.hours).toBeCloseTo(4, 1);
    });
  });
});

// Helper to make the "layover caps at 24h" test a little less noisy.
function awaitable<T>(p: Promise<T>): Promise<T> {
  return p;
}
