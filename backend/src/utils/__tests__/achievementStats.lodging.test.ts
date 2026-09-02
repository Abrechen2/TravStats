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
 *   3. `unionCountries` — merges + dedups per-domain country sets. It is also
 *      the seam that folds the three domains' country vocabularies (ISO code /
 *      English name / free text) into ISO codes, so one country is one country.
 */

import {
  calculateUserStats,
  computeFlyAndStayFlags,
  type FlightData,
  type TripDomainCounts,
} from '../achievementStats';
// Moved to the one home in step 4 of the country-counting design; the cases
// below are unchanged, so they pin the same truth table in its new place.
import { normalizeCountrySet, unionCountries } from '../../shared/countryEvidence';
import { getCachedAirports } from '../../services/airportCache';

jest.mock('../../services/airportCache', () => ({
  getCachedAirports: jest.fn(async () => new Map()),
}));

/** Minimal flown flight between two airports — only the fields the country
 *  path reads carry meaning; the rest are the schema's empty values. */
function flightBetween(depIata: string, arrIata: string): FlightData {
  return {
    id: `${depIata}-${arrIata}`,
    depLat: 0,
    depLon: 0,
    arrLat: 0,
    arrLon: 0,
    depIcao: null,
    depIata,
    arrIcao: null,
    arrIata,
    airline: null,
    aircraft: null,
    flightNumber: null,
    seatNumber: null,
    seatClass: null,
    notes: null,
    actualDeparture: null,
    delayMinutes: null,
    departureTime: null,
    arrivalTime: null,
    status: 'flown',
    specialType: null,
  };
}

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
  it('merges and dedups countries across domains, as ISO codes', () => {
    const flightCountries = new Set(['Germany', 'France']);
    const cruiseCountries = new Set(['France', 'Spain']);
    const lodgingCountries = new Set(['Spain', 'Switzerland']);

    const union = unionCountries(flightCountries, cruiseCountries, lodgingCountries);

    expect([...union].sort()).toEqual(['CH', 'DE', 'ES', 'FR']);
  });

  it('returns an empty set when every input is empty', () => {
    expect(unionCountries(new Set(), new Set()).size).toBe(0);
  });

  it('handles a single input set', () => {
    const union = unionCountries(new Set(['Italy']));
    expect([...union]).toEqual(['IT']);
  });

  // The bug this whole seam exists for. The domains speak three vocabularies:
  // airports carry ISO codes, cruise ports English names, `Lodging.country`
  // free text in the booking mail's language. Unioning the raw strings reported
  // 88 countries on an account whose passport holds 32, which handed out a
  // COUNTRIES_100 badge to a traveller with roughly 35.
  it('counts a flight "DE" and a lodging "Deutschland" as ONE country', () => {
    const flightCountries = new Set(['DE']);
    const lodgingCountries = new Set(['Deutschland']);

    const union = unionCountries(flightCountries, lodgingCountries);

    expect(union.size).toBe(1);
    expect([...union]).toEqual(['DE']);
  });

  it('collapses every spelling measured on the real account', () => {
    // Verbatim from the owner's data — 4 countries hiding behind 9 strings.
    const union = unionCountries(
      new Set(['AT', 'CH', 'DE', 'CZ']),
      new Set(['Austria', 'Switzerland', 'Germany', 'Czechia']),
      new Set([
        'Österreich',
        'Schweiz',
        'Schweiz/Suisse/Svizzera/Svizra',
        'Deutschland',
        'Tschechien',
        'Česko',
      ]),
    );

    expect([...union].sort()).toEqual(['AT', 'CH', 'CZ', 'DE']);
  });

  it('DROPS a contribution it cannot place instead of counting the raw string', () => {
    // "Dubai" is a city, not a country — the same cut `shared/placeCounting.ts`
    // makes. A country nobody can check by looking is worse than a missing one.
    const union = unionCountries(new Set(['Dubai', 'ZZ', '', 'Germany']));

    expect([...union]).toEqual(['DE']);
  });
});

describe('normalizeCountrySet', () => {
  it('folds a free-text set to ISO codes and drops the unplaceable', () => {
    const codes = normalizeCountrySet(new Set(['Deutschland', 'Germany', 'Dubai', 'italy']));

    expect([...codes].sort()).toEqual(['DE', 'IT']);
  });

  it('is idempotent — feeding it codes changes nothing', () => {
    const once = normalizeCountrySet(new Set(['Deutschland', 'FR']));
    const twice = normalizeCountrySet(once);

    expect([...twice].sort()).toEqual([...once].sort());
  });
});

describe('calculateUserStats — country vocabulary', () => {
  it('yields ISO codes for flights, which then merge with a German lodging name', async () => {
    // The production path: `achievements.ts` seeds the union with
    // `stats.countries` and folds the lodging set in on top.
    const cacheMock = getCachedAirports as unknown as jest.Mock;
    cacheMock.mockResolvedValueOnce(
      new Map([
        ['FRA', { country: 'DE', lat: 50.03, lon: 8.57 }],
        ['MUC', { country: 'DE', lat: 48.35, lon: 11.79 }],
      ]),
    );

    const stats = await calculateUserStats([flightBetween('FRA', 'MUC')]);
    expect([...stats.countries]).toEqual(['DE']);

    const union = unionCountries(stats.countries, new Set(['Deutschland']));
    expect(union.size).toBe(1);
  });
});
