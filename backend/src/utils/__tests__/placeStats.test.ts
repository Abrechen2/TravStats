import { describe, it, expect } from '@jest/globals';
import { calculatePlaceStats, type PlaceStatsInput } from '../placeStats';

const NOW = new Date('2026-08-23T12:00:00Z');
const PAST = new Date('2024-06-12T10:00:00Z');
const FUTURE = new Date('2026-09-30T10:00:00Z');

const place = (over: Partial<PlaceStatsInput> = {}): PlaceStatsInput => ({
  visited: true,
  category: 'landmark',
  isoCountryCode: 'IT',
  curatedItemId: null,
  visits: [],
  ...over,
});

describe('calculatePlaceStats', () => {
  it('counts a visited place that has no visit row at all', () => {
    // "I have definitely been to that Maccis, no idea when" — the dateless
    // memory. The LodgingStay 2.7 precedent, and the reason the flag and the
    // visit rows are two separate questions.
    const stats = calculatePlaceStats([place({ visits: [] })], NOW);
    expect(stats.placesCount).toBe(1);
    expect(stats.placeVisitsCount).toBe(0);
  });

  it('counts an UNDATED visit but not a future-dated one', () => {
    const stats = calculatePlaceStats(
      [place({ visits: [{ visitedAt: null }, { visitedAt: PAST }, { visitedAt: FUTURE }] })],
      NOW
    );
    expect(stats.placesCount).toBe(1);
    expect(stats.placeVisitsCount).toBe(2);
  });

  it('excludes a wishlist entry from every figure', () => {
    const stats = calculatePlaceStats(
      [place({ visited: false, isoCountryCode: 'PE', visits: [{ visitedAt: FUTURE }] })],
      NOW
    );
    expect(stats.placesCount).toBe(0);
    expect(stats.placeCountries.size).toBe(0);
    expect(stats.placesInCategoryMax).toBe(0);
  });

  it('separates places from visits — the whole point of the split (#177)', () => {
    // One McDonald's, three visits. Conflating the two is what option (a)
    // could never express.
    const stats = calculatePlaceStats(
      [
        place({
          category: 'restaurant',
          visits: [{ visitedAt: PAST }, { visitedAt: PAST }, { visitedAt: null }],
        }),
      ],
      NOW
    );
    expect(stats.placesCount).toBe(1);
    expect(stats.placeVisitsCount).toBe(3);
  });

  it('joins countries on the ISO code and upper-cases it', () => {
    const stats = calculatePlaceStats(
      [
        place({ isoCountryCode: 'it' }),
        place({ isoCountryCode: 'IT' }),
        place({ isoCountryCode: 'JO' }),
        place({ isoCountryCode: null }),
      ],
      NOW
    );
    expect(stats.placeCountries).toEqual(new Set(['IT', 'JO']));
  });

  it('reports the biggest single category, not the total', () => {
    const stats = calculatePlaceStats(
      [
        place({ category: 'restaurant' }),
        place({ category: 'restaurant' }),
        place({ category: 'restaurant' }),
        place({ category: 'museum' }),
      ],
      NOW
    );
    expect(stats.placesInCategoryMax).toBe(3);
  });

  it('keeps checklist progress per list, not as one maximum', () => {
    // A single number here would make both wonders badges report the same
    // progress — the failure the per-list map exists to prevent.
    const stats = calculatePlaceStats(
      [
        place({ curatedItemId: 'world-wonders-new7:colosseum' }),
        place({ curatedItemId: 'world-wonders-new7:petra' }),
        place({ curatedItemId: 'world-wonders-ancient:great-pyramid' }),
        // Unticked again: still in the logbook, no longer counted anywhere.
        place({ visited: false, curatedItemId: 'world-wonders-ancient:hanging-gardens' }),
      ],
      NOW
    );
    expect(stats.curatedTickedByList.get('world-wonders-new7')).toBe(2);
    expect(stats.curatedTickedByList.get('world-wonders-ancient')).toBe(1);
  });

  it('returns zeros for an empty logbook', () => {
    const stats = calculatePlaceStats([], NOW);
    expect(stats.placesCount).toBe(0);
    expect(stats.placesInCategoryMax).toBe(0);
    expect(stats.curatedTickedByList.size).toBe(0);
  });
});
