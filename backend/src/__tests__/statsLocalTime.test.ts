import {
  calculateFunStats,
  calculateBusinessStats,
  calculateUniqueStats,
  calculateAirportStats,
} from '../utils/statsCalculator';
import type { FlightData } from '../utils/statsCalculator';

// The stats modules hit the airport cache for country/altitude metadata. The
// departure timezone reaches them on the flight row itself (resolved by the
// route), so an empty map keeps these tests off PostgreSQL without weakening
// what they assert.
jest.mock('../services/airportCache', () => ({
  getCachedAirports: jest.fn(async () => new Map()),
  getCachedAirport: jest.fn(async () => null),
}));

let seq = 0;

function flight(partial: Partial<FlightData>): FlightData {
  seq += 1;
  return {
    id: `f-${seq}`,
    depLat: 52.5,
    depLon: 13.4,
    arrLat: 48.1,
    arrLon: 11.6,
    depIata: 'BER',
    depIcao: null,
    arrIata: 'MUC',
    arrIcao: null,
    airline: 'Test Air',
    aircraft: null,
    departureTime: new Date('2026-07-01T05:00:00Z'),
    arrivalTime: new Date('2026-07-01T06:00:00Z'),
    status: 'flown',
    price: null,
    taxes: null,
    fees: null,
    category: null,
    seatClass: null,
    createdAt: new Date(),
    depTimeSemantics: 'UTC',
    ...partial,
  };
}

describe('time-of-day statistics use the clock at the departure airport (#266)', () => {
  it('counts a 07:00 Berlin departure as a morning flight, not a night one', async () => {
    // 07:00 Berlin summer time is 05:00 UTC.
    const stats = await calculateFunStats([
      flight({
        departureTime: new Date('2026-07-01T05:00:00Z'),
        arrivalTime: new Date('2026-07-01T06:00:00Z'),
        depTimezone: 'Europe/Berlin',
      }),
    ]);

    expect(stats.earlyBird).toBe(1);
    expect(stats.nightOwl).toBe(0);
  });

  it('counts a Monday 00:30 Tokyo departure as a weekday, not a weekend flight', async () => {
    // Monday 00:30 in Tokyo is Sunday 15:30 UTC.
    const stats = await calculateFunStats([
      flight({
        depIata: 'HND',
        departureTime: new Date('2026-07-05T15:30:00Z'),
        arrivalTime: new Date('2026-07-05T17:30:00Z'),
        depTimezone: 'Asia/Tokyo',
      }),
    ]);

    expect(stats.weekendWarrior).toBe(0);
    expect(stats.weekendPercentage).toBe(0);
  });

  it('files a late New York departure under the year it was flown', async () => {
    // 22:30 on 31 December in New York is 03:30 on 1 January UTC.
    const stats = await calculateFunStats([
      flight({
        depIata: 'JFK',
        departureTime: new Date('2026-01-01T03:30:00Z'),
        arrivalTime: new Date('2026-01-01T10:30:00Z'),
        depTimezone: 'America/New_York',
      }),
    ]);

    expect(stats.milestoneYear).toBe(2025);
    expect(stats.fastestDay).toBe('2025-12-31');
  });

  it('groups two departures on the same local day into one busiest day', async () => {
    // Both leave Auckland on 15 March local; in UTC they straddle midnight.
    const stats = await calculateFunStats([
      flight({
        depIata: 'AKL',
        departureTime: new Date('2026-03-14T20:00:00Z'), // 09:00 local, 15 Mar
        arrivalTime: new Date('2026-03-14T22:00:00Z'),
        depTimezone: 'Pacific/Auckland',
      }),
      flight({
        depIata: 'AKL',
        departureTime: new Date('2026-03-15T02:00:00Z'), // 15:00 local, 15 Mar
        arrivalTime: new Date('2026-03-15T04:00:00Z'),
        depTimezone: 'Pacific/Auckland',
      }),
    ]);

    expect(stats.fastestDay).toBe('2026-03-15');
    expect(stats.fastestDayFlights).toBe(2);
  });

  it('does not shift a legacy fake-UTC row a second time', async () => {
    // The stored components already ARE the local wall clock: 10:30 in Berlin.
    const stats = await calculateFunStats([
      flight({
        departureTime: new Date('2020-05-01T10:30:00Z'),
        arrivalTime: new Date('2020-05-01T11:30:00Z'),
        depTimezone: 'Europe/Berlin',
        depTimeSemantics: 'LEGACY_FAKE_UTC',
      }),
    ]);

    expect(stats.earlyBird).toBe(1); // 10:30, not 12:30
    expect(stats.afternoon).toBe(0);
  });

  it('leaves a date-only row out of the time-of-day buckets', async () => {
    // A DATE_ONLY row carries a 12:00 placeholder — counting it as an
    // afternoon flight would present a placeholder as an observation.
    const stats = await calculateFunStats([
      flight({
        departureTime: new Date('2026-07-01T10:00:00Z'),
        arrivalTime: new Date('2026-07-01T10:00:00Z'),
        depTimezone: 'Europe/Berlin',
        depTimeSemantics: 'DATE_ONLY',
      }),
    ]);

    expect(stats.earlyBird).toBe(0);
    expect(stats.afternoon).toBe(0);
    expect(stats.nightOwl).toBe(0);
  });

  it('reads the busiest month on the local clock', async () => {
    // 31 January 22:00 in New York is 1 February 03:00 UTC.
    const stats = calculateBusinessStats(
      [
        flight({
          depIata: 'JFK',
          departureTime: new Date('2026-02-01T03:00:00Z'),
          arrivalTime: new Date('2026-02-01T10:00:00Z'),
          depTimezone: 'America/New_York',
        }),
      ],
      'EUR',
    );

    expect(stats.busiestMonth).toBe('Jan');
  });

  it('reads the season on the local clock', async () => {
    // 28 February 23:00 in Tokyo is 1 March 14:00 UTC — still winter locally.
    const stats = await calculateUniqueStats([
      flight({
        depIata: 'HND',
        departureTime: new Date('2026-02-28T14:00:00Z'),
        arrivalTime: new Date('2026-02-28T16:00:00Z'),
        depTimezone: 'Asia/Tokyo',
      }),
    ]);

    expect(stats.seasonsCount).toBe(1);
  });

  it('dates a first airport visit on the local clock', async () => {
    const stats = await calculateAirportStats(
      [
        flight({
          depIata: 'JFK',
          arrIata: 'LHR',
          departureTime: new Date('2026-01-01T03:30:00Z'), // 31 Dec local
          arrivalTime: new Date('2026-01-01T10:30:00Z'),
          depTimezone: 'America/New_York',
        }),
      ],
      [],
    );

    const jfk = stats.newThisYear.find((a) => a.code === 'JFK');
    expect(jfk).toBeUndefined(); // 2025 locally, so not new in 2026
  });

  it('falls back to the stored components when the airport has no timezone', async () => {
    // No timezone on file — the stored value is the only reading available.
    // 05:00 belongs to the night bucket and must stay there rather than being
    // quietly shifted by the server's own zone.
    const stats = await calculateFunStats([
      flight({
        departureTime: new Date('2026-07-01T05:00:00Z'),
        arrivalTime: new Date('2026-07-01T06:00:00Z'),
        depTimezone: null,
      }),
    ]);

    expect(stats.nightOwl).toBe(1);
    expect(stats.earlyBird).toBe(0);
  });
});
