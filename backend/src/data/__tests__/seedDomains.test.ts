import { describe, it, expect } from '@jest/globals';
import { achievements } from '../achievements';
import { DOMAIN_KEYS } from '../../shared/domains';

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
    // DERIVED from the domain registry rather than typed out again. The
    // hardcoded list was a fourth place that had to be edited when a domain
    // arrived — and the one that failed the POI badges after the other three
    // were already right.
    const allowed = new Set<string>([...DOMAIN_KEYS, 'shared']);
    for (const a of achievements) {
      expect(allowed.has(a.domain)).toBe(true);
    }
  });
});
