import { flightDurationOf, measureFlightMinutes } from '../flightDuration';

// FRA (50.04/8.56) → JFK (40.64/-73.78): ~6200 km great-circle, so the
// coordinate estimate is ~480 minutes. The placeholder clocks below are chosen
// to disagree with that figure, so a test cannot pass by accident.
const FRA_JFK = { depLat: 50.0379, depLon: 8.5622, arrLat: 40.6398, arrLon: -73.7789 };

/**
 * forgejo#76 — a DATE_ONLY row carries "12:00 → 13:00" that nobody measured.
 * Four aggregates subtracted those placeholders anyway. The rule is now one
 * function, mirrored in `frontend/src/shared/flightDuration.ts`; this test and
 * the frontend one assert the same numbers.
 */
describe('measureFlightMinutes — the clocks are evidence only under UTC semantics', () => {
  it('measures a UTC row', () => {
    expect(
      measureFlightMinutes({
        ...FRA_JFK,
        departureTime: new Date('2024-05-01T10:00:00Z'),
        arrivalTime: new Date('2024-05-01T18:30:00Z'),
        depTimeSemantics: 'UTC',
      }),
    ).toBe(510);
  });

  it('treats a row without the column as UTC (it predates the column)', () => {
    expect(
      measureFlightMinutes({
        ...FRA_JFK,
        departureTime: '2024-05-01T10:00:00Z',
        arrivalTime: '2024-05-01T11:00:00Z',
      }),
    ).toBe(60);
  });

  it.each(['DATE_ONLY', 'UNKNOWN', 'LEGACY_FAKE_UTC'])(
    'returns null for %s semantics, whatever the placeholder clocks say',
    (semantics) => {
      expect(
        measureFlightMinutes({
          ...FRA_JFK,
          departureTime: new Date('1989-03-15T12:00:00Z'),
          arrivalTime: new Date('1989-03-15T13:00:00Z'),
          depTimeSemantics: semantics,
        }),
      ).toBeNull();
    },
  );

  it('returns null for a missing clock and for a non-positive difference', () => {
    expect(
      measureFlightMinutes({ ...FRA_JFK, departureTime: new Date(), arrivalTime: null }),
    ).toBeNull();
    expect(
      measureFlightMinutes({
        ...FRA_JFK,
        departureTime: new Date('2024-05-01T12:00:00Z'),
        arrivalTime: new Date('2024-05-01T12:00:00Z'),
      }),
    ).toBeNull();
  });
});

describe('flightDurationOf — measure when allowed, else estimate, else nothing', () => {
  it('estimates a DATE_ONLY row from its coordinates and says so', () => {
    const result = flightDurationOf({
      ...FRA_JFK,
      departureTime: new Date('1989-03-15T12:00:00Z'),
      arrivalTime: new Date('1989-03-15T13:00:00Z'),
      depTimeSemantics: 'DATE_ONLY',
    });
    expect(result?.estimated).toBe(true);
    // Not the 60 minutes the placeholders would have measured.
    expect(result?.minutes).toBeGreaterThan(400);
    expect(result?.minutes).toBeLessThan(560);
  });

  it('measures a UTC row and marks it as measured', () => {
    expect(
      flightDurationOf({
        ...FRA_JFK,
        departureTime: new Date('2024-05-01T10:00:00Z'),
        arrivalTime: new Date('2024-05-01T18:00:00Z'),
        depTimeSemantics: 'UTC',
      }),
    ).toEqual({ minutes: 480, estimated: false });
  });

  it('answers null, never 0, with neither clocks nor coordinates', () => {
    expect(
      flightDurationOf({
        departureTime: null,
        arrivalTime: null,
        depLat: null,
        depLon: null,
        arrLat: null,
        arrLon: null,
      }),
    ).toBeNull();
  });
});
