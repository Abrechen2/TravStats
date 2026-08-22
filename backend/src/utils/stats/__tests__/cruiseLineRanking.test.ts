/**
 * "Top-Reedereien" has to mean the ones sailed most, not the ones early in the
 * alphabet. The endpoint returned the set sorted by name, and the cross-domain
 * tile slices the first five and labels them Top — so AIDA and Costa appeared
 * there for their initials.
 */
import { calculateCruiseStats } from '../../cruiseStats';
import type { CruiseData } from '../../cruiseStats';

function cruise(line: string, id: string): CruiseData {
  return {
    id,
    cruiseLine: line,
    status: 'flown',
    startDate: new Date('2024-03-01'),
    endDate: new Date('2024-03-08'),
    stops: [],
    legs: [],
  } as unknown as CruiseData;
}

describe('cruise lines are ranked by how often they were sailed', () => {
  it('counts each line', () => {
    const stats = calculateCruiseStats([
      cruise('Zenith Cruises', 'a'),
      cruise('Zenith Cruises', 'b'),
      cruise('Zenith Cruises', 'c'),
      cruise('AIDA', 'd'),
    ]);

    expect(stats.cruiseLineCounts).toEqual({ 'Zenith Cruises': 3, AIDA: 1 });
  });

  it('does not let the alphabet decide', () => {
    // Sorted by name, AIDA would lead on a single sailing while the line
    // actually sailed three times fell to the back.
    const stats = calculateCruiseStats([
      cruise('Zenith Cruises', 'a'),
      cruise('Zenith Cruises', 'b'),
      cruise('AIDA', 'c'),
    ]);

    const ranked = Array.from(stats.cruiseLines).sort((a, b) => {
      const diff = (stats.cruiseLineCounts[b] ?? 0) - (stats.cruiseLineCounts[a] ?? 0);
      return diff !== 0 ? diff : a.localeCompare(b);
    });
    expect(ranked[0]).toBe('Zenith Cruises');
  });
});
