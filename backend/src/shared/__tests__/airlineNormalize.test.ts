import { mergeAirlineCounts, normalizeAirline } from '../airlineNormalize';

describe('shared/airlineNormalize', () => {
  it('maps a known spelling variant to the canonical name', () => {
    expect(normalizeAirline('egypt air')).toBe('EgyptAir');
    expect(normalizeAirline('EGYPTAIR')).toBe('EgyptAir');
    expect(normalizeAirline('vietnam airline')).toBe('Vietnam Airlines');
  });

  it('leaves an unknown name alone rather than guessing', () => {
    expect(normalizeAirline('  Condor  ')).toBe('Condor');
    expect(normalizeAirline('Air India')).toBe('Air India');
  });

  // The #268 symptom: the KPI tile counted buckets, the ranking below counted
  // canonical names, and the two disagreed on the same screen.
  it('collapses variants into one bucket when counting', () => {
    const merged = mergeAirlineCounts({ 'egypt air': 2, EgyptAir: 3, Condor: 1 });
    expect(merged).toEqual({ EgyptAir: 5, Condor: 1 });
    expect(Object.keys(merged)).toHaveLength(2);
  });
});
