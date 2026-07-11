import { describe, it, expect } from '@jest/globals';
import { achievements } from '../achievements';

describe('achievement seed domains', () => {
  it('every achievement has a domain field', () => {
    for (const a of achievements) {
      expect(a.domain).toBeTruthy();
    }
  });

  it('country/continent achievements are shared', () => {
    for (const a of achievements) {
      if (a.requirementType === 'countries' || a.requirementType === 'continents') {
        expect(a.domain).toBe('shared');
      }
    }
  });

  it('no achievement uses a non-allowed domain value', () => {
    const allowed = new Set(['flight', 'cruise', 'lodging', 'shared']);
    for (const a of achievements) {
      expect(allowed.has(a.domain)).toBe(true);
    }
  });
});
