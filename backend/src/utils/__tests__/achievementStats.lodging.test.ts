/**
 * Lodging fields on the cross-domain `UserStats` object:
 *   1. `calculateUserStats` must initialize every new lodging field to a
 *      sane default (0 / false / empty Set) even for a user with zero
 *      flights — nothing left `undefined`/`NaN`.
 *   2. `computeFlyAndStayFlags` — the pure per-trip derivation of
 *      `flyAndStay` / `grandTour`. The critical trap: a user who has a
 *      flight in one trip and a lodging stay in an unrelated trip must
 *      NOT satisfy `flyAndStay` — only a trip that itself links both
 *      domains counts.
 *   3. `unionCountries` — merges + dedups per-domain country sets.
 */

import {
  calculateUserStats,
  computeFlyAndStayFlags,
  unionCountries,
  type FlightData,
  type TripDomainCounts,
} from '../achievementStats';

jest.mock('../../services/airportCache', () => ({
  getCachedAirports: jest.fn(async () => new Map()),
}));

describe('UserStats — lodging field defaults', () => {
  it('initializes every lodging field to a sane zero/empty default for a user with no flights', async () => {
    const stats = await calculateUserStats([] as FlightData[]);

    expect(stats.lodgingsCount).toBe(0);
    expect(stats.lodgingStaysCount).toBe(0);
    expect(stats.lodgingNights).toBe(0);
    expect(stats.lodgingChainsUnique).toBe(0);
    expect(stats.lodgingCountries).toBeInstanceOf(Set);
    expect(stats.lodgingCountries.size).toBe(0);
    expect(stats.lodgingSpendBase).toBe(0);
    expect(stats.lodgingAwardNights).toBe(0);
    expect(stats.lodgingChainLoyaltyMax).toBe(0);
    expect(stats.lodgingSameHotelRepeatMax).toBe(0);
    expect(stats.lodgingLongestStayNights).toBe(0);
    expect(stats.flyAndStay).toBe(false);
    expect(stats.grandTour).toBe(false);

    // Nothing should be NaN or undefined.
    for (const [key, value] of Object.entries(stats)) {
      if (typeof value === 'number') {
        expect(Number.isNaN(value)).toBe(false);
      }
      expect(value).not.toBeUndefined();
      void key;
    }
  });
});

describe('computeFlyAndStayFlags', () => {
  it('is true when the same trip links a flight and a stay', () => {
    const trips: TripDomainCounts[] = [
      { flightCount: 1, cruiseCount: 0, lodgingStayCount: 1 },
    ];
    expect(computeFlyAndStayFlags(trips).flyAndStay).toBe(true);
    expect(computeFlyAndStayFlags(trips).grandTour).toBe(false);
  });

  it('is FALSE when the flight and the stay are in separate trips', () => {
    const trips: TripDomainCounts[] = [
      { flightCount: 1, cruiseCount: 0, lodgingStayCount: 0 }, // trip A: flight only
      { flightCount: 0, cruiseCount: 0, lodgingStayCount: 1 }, // trip B: stay only
    ];
    expect(computeFlyAndStayFlags(trips).flyAndStay).toBe(false);
    expect(computeFlyAndStayFlags(trips).grandTour).toBe(false);
  });

  it('is false for a user with no trips at all', () => {
    expect(computeFlyAndStayFlags([]).flyAndStay).toBe(false);
    expect(computeFlyAndStayFlags([]).grandTour).toBe(false);
  });

  it('grandTour is true only when one trip has a flight, a cruise, AND a stay', () => {
    const trips: TripDomainCounts[] = [
      { flightCount: 1, cruiseCount: 1, lodgingStayCount: 1 },
    ];
    expect(computeFlyAndStayFlags(trips).grandTour).toBe(true);
    expect(computeFlyAndStayFlags(trips).flyAndStay).toBe(true);
  });

  it('grandTour is false when a trip has flight+cruise but no stay, even if flyAndStay fires elsewhere', () => {
    const trips: TripDomainCounts[] = [
      { flightCount: 1, cruiseCount: 1, lodgingStayCount: 0 }, // trip A: fly+sail, no stay
      { flightCount: 1, cruiseCount: 0, lodgingStayCount: 1 }, // trip B: fly+stay, no cruise
    ];
    const flags = computeFlyAndStayFlags(trips);
    expect(flags.flyAndStay).toBe(true);
    expect(flags.grandTour).toBe(false);
  });
});

describe('unionCountries', () => {
  it('merges and dedups countries across domains', () => {
    const flightCountries = new Set(['Germany', 'France']);
    const cruiseCountries = new Set(['France', 'Spain']);
    const lodgingCountries = new Set(['Spain', 'Switzerland']);

    const union = unionCountries(flightCountries, cruiseCountries, lodgingCountries);

    expect([...union].sort()).toEqual(['France', 'Germany', 'Spain', 'Switzerland']);
  });

  it('returns an empty set when every input is empty', () => {
    expect(unionCountries(new Set(), new Set()).size).toBe(0);
  });

  it('handles a single input set', () => {
    const union = unionCountries(new Set(['Italy']));
    expect([...union]).toEqual(['Italy']);
  });
});
