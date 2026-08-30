import { calculatePlaceStats, longestDayStreak, type PlaceStatsInput } from '../placeStats';

/**
 * The measures Part H reads.
 *
 * Each case here is an edge where the number could be plausibly wrong and
 * nobody would notice: a badge is a single integer on a page, with nothing
 * beside it to contradict. The two inherited rules are re-checked rather than
 * assumed, because every one of these measures turns on them — an UNDATED visit
 * counts towards HOW MANY and towards nothing asking WHEN, and a FUTURE-dated
 * visit has not happened.
 */
const NOW = new Date('2026-08-29T00:00:00Z');

const place = (over: Partial<PlaceStatsInput> = {}): PlaceStatsInput => ({
  visited: true,
  category: 'restaurant',
  isoCountryCode: 'IT',
  city: 'Rom',
  lat: 41.9,
  lon: 12.48,
  curatedItemId: null,
  visits: [],
  ...over,
});

const on = (iso: string, extra: { rating?: number | null; tripId?: string | null } = {}) => ({
  visitedAt: new Date(iso),
  ...extra,
});

describe('calculatePlaceStats — the Part H measures', () => {
  it('counts an undated visit towards totals and towards no day', () => {
    const stats = calculatePlaceStats(
      [place({ visits: [on('2023-04-01T10:00:00Z'), { visitedAt: null }] })],
      NOW,
    );

    expect(stats.placeVisitsCount).toBe(2);
    expect(stats.placeSameRepeatMax).toBe(2);
    // …but it marks no day, so it cannot extend a streak or a busy day.
    expect(stats.placesInOneDayMax).toBe(1);
    expect(stats.placeVisitStreakMax).toBe(1);
    expect(stats.placeVisitsInYearMax).toBe(1);
  });

  it('leaves a future-dated visit out of every measure', () => {
    const stats = calculatePlaceStats(
      [place({ visits: [on('2027-01-01T10:00:00Z')] })],
      NOW,
    );

    expect(stats.placeVisitsCount).toBe(0);
    expect(stats.placeSameRepeatMax).toBe(0);
    expect(stats.placeVisitsInYearMax).toBe(0);
  });

  it('counts distinct PLACES on a day, not visits', () => {
    // Three coffees at one café is one place that day, or "most places in a
    // day" rewards sitting still.
    const stats = calculatePlaceStats(
      [
        place({
          visits: [
            on('2023-04-01T09:00:00Z'),
            on('2023-04-01T13:00:00Z'),
            on('2023-04-01T19:00:00Z'),
          ],
        }),
        place({ city: 'Rom', visits: [on('2023-04-02T09:00:00Z')] }),
        place({ city: 'Rom', visits: [on('2023-04-02T11:00:00Z')] }),
      ],
      NOW,
    );

    expect(stats.placesInOneDayMax).toBe(2);
  });

  it('counts a streak in calendar days, across a month boundary', () => {
    const stats = calculatePlaceStats(
      [
        place({ visits: [on('2023-01-30T10:00:00Z')] }),
        place({ visits: [on('2023-01-31T10:00:00Z')] }),
        place({ visits: [on('2023-02-01T10:00:00Z')] }),
        place({ visits: [on('2023-03-15T10:00:00Z')] }),
      ],
      NOW,
    );

    expect(stats.placeVisitStreakMax).toBe(3);
  });

  it('takes the busiest single year, not the total', () => {
    const stats = calculatePlaceStats(
      [
        place({ visits: [on('2022-01-01T10:00:00Z'), on('2022-06-01T10:00:00Z')] }),
        place({ visits: [on('2023-01-01T10:00:00Z')] }),
      ],
      NOW,
    );

    expect(stats.placeVisitsCount).toBe(3);
    expect(stats.placeVisitsInYearMax).toBe(2);
  });

  it('counts countries within one year, not across all of them', () => {
    const stats = calculatePlaceStats(
      [
        place({ isoCountryCode: 'IT', visits: [on('2022-01-01T10:00:00Z')] }),
        place({ isoCountryCode: 'FR', visits: [on('2022-05-01T10:00:00Z')] }),
        place({ isoCountryCode: 'JP', visits: [on('2023-05-01T10:00:00Z')] }),
      ],
      NOW,
    );

    expect(stats.placeCountries.size).toBe(3);
    expect(stats.placeCountriesInYearMax).toBe(2);
  });

  it('ignores a wishlist entry everywhere', () => {
    const stats = calculatePlaceStats(
      [
        place({ visited: false, city: 'Barcelona', isoCountryCode: 'ES', lat: 41.4 }),
        place({ visits: [on('2023-04-01T10:00:00Z')] }),
      ],
      NOW,
    );

    expect(stats.placesCount).toBe(1);
    expect(stats.placeCities).toEqual(new Set(['Rom']));
    expect(stats.placeCountries).toEqual(new Set(['IT']));
  });

  it('leaves a place without a city out of the city set rather than adding a blank', () => {
    const stats = calculatePlaceStats(
      [place({ city: null, visits: [on('2023-04-01T10:00:00Z')] })],
      NOW,
    );

    expect(stats.placeCities.size).toBe(0);
  });

  it('resolves continents from the coordinates', () => {
    const stats = calculatePlaceStats(
      [
        place({ lat: 41.9, lon: 12.48, isoCountryCode: 'IT' }),
        place({ lat: 35.68, lon: 139.69, isoCountryCode: 'JP', city: 'Tokio' }),
        place({ lat: -33.86, lon: 151.2, isoCountryCode: 'AU', city: 'Sydney' }),
      ],
      NOW,
    );

    expect(stats.placeContinents).toEqual(new Set(['Europe', 'Asia', 'Oceania']));
  });

  it('reports the extremes, and a southern one as a negative', () => {
    const stats = calculatePlaceStats(
      [
        place({ lat: 69.65, city: 'Tromsø', isoCountryCode: 'NO' }),
        place({ lat: -54.81, city: 'Ushuaia', isoCountryCode: 'AR' }),
      ],
      NOW,
    );

    expect(stats.placeNorthernLat).toBeCloseTo(69.65);
    // Negative, so the check can tell a southern place from a northern one
    // before taking an absolute value.
    expect(stats.placeSouthernLat).toBeCloseTo(-54.81);
  });

  it('counts ratings and trip links only on visits that happened', () => {
    const stats = calculatePlaceStats(
      [
        place({
          visits: [
            on('2023-04-01T10:00:00Z', { rating: 5, tripId: 't1' }),
            on('2027-01-01T10:00:00Z', { rating: 5, tripId: 't1' }),
            on('2023-05-01T10:00:00Z'),
          ],
        }),
      ],
      NOW,
    );

    expect(stats.placeRatedVisits).toBe(1);
    expect(stats.placeTripVisits).toBe(1);
  });

  it('counts how many categories were used, not how many places', () => {
    const stats = calculatePlaceStats(
      [
        place({ category: 'museum' }),
        place({ category: 'museum' }),
        place({ category: 'nature' }),
      ],
      NOW,
    );

    expect(stats.placeCategoriesUnique).toBe(2);
    expect(stats.placesInCategoryMax).toBe(2);
  });

  it('returns zeroes rather than -Infinity for an empty logbook', () => {
    // Math.max of nothing is -Infinity, which would render as a badge at
    // minus infinity per cent.
    const stats = calculatePlaceStats([], NOW);

    expect(stats.placesInCategoryMax).toBe(0);
    expect(stats.placesInOneDayMax).toBe(0);
    expect(stats.placeVisitsInYearMax).toBe(0);
    expect(stats.placeCountriesInYearMax).toBe(0);
    expect(stats.placeVisitStreakMax).toBe(0);
    expect(stats.placeNorthernLat).toBeNull();
  });
});

describe('longestDayStreak', () => {
  it('counts consecutive days and ignores repeats', () => {
    expect(longestDayStreak(['2023-04-01', '2023-04-01', '2023-04-02'])).toBe(2);
  });

  it('is not broken by a year boundary', () => {
    expect(longestDayStreak(['2023-12-31', '2024-01-01'])).toBe(2);
  });

  it('is zero for nothing and one for a single day', () => {
    expect(longestDayStreak([])).toBe(0);
    expect(longestDayStreak(['2023-04-01'])).toBe(1);
  });
});
