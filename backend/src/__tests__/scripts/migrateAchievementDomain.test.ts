import { describe, it, expect } from '@jest/globals';
import { shouldBeShared, SHARED_ACHIEVEMENT_CODE_PATTERNS } from '../../scripts/migrateAchievementDomain';

describe('migrateAchievementDomain', () => {
  const cases: Array<[string, boolean]> = [
    ['COUNTRIES_10',        true],
    ['COUNTRIES_50',        true],
    ['CONTINENTS_ALL',      true],
    ['CONTINENT_EUROPE',    true],
    ['AIRCRAFT_SPOTTER',    false],
    ['AIRLINE_LOYALTY',     false],
    ['DISTANCE_1M',         false],
    ['BIRTHDAY_FLIGHT',     false],
  ];

  it.each(cases)('classifies %s correctly', (code, expected) => {
    expect(shouldBeShared(code)).toBe(expected);
  });

  it('exposes the patterns list', () => {
    expect(SHARED_ACHIEVEMENT_CODE_PATTERNS.length).toBeGreaterThan(0);
  });
});
