import { describe, it, expect } from '@jest/globals';
import {
  DOMAIN_KEYS,
  DOMAINS,
  AVAILABLE_DOMAINS,
  isValidDomain,
  getDomainDescriptor,
  type DomainKey,
} from '../../shared/domains';

describe('domain registry', () => {
  it('exposes all domain keys', () => {
    expect(DOMAIN_KEYS).toEqual(['flight', 'cruise', 'lodging', 'poi']);
  });

  it('only lists available domains in AVAILABLE_DOMAINS', () => {
    // All four ship now — `poi` joined when the Places domain replaced the
    // stub. Assert the RELATIONSHIP rather than a frozen list: this test
    // exists to catch a descriptor and the derived list disagreeing, not to
    // count domains. Mirrors frontend/src/__tests__/shared/domains.test.ts.
    expect(AVAILABLE_DOMAINS).toEqual(DOMAIN_KEYS.filter((k) => DOMAINS[k].available));
    expect(AVAILABLE_DOMAINS).toEqual(['flight', 'cruise', 'lodging', 'poi']);
  });

  it('every descriptor has required fields', () => {
    for (const key of DOMAIN_KEYS) {
      const d = DOMAINS[key];
      expect(d.key).toBe(key);
      expect(typeof d.available).toBe('boolean');
      expect(d.i18nKey).toMatch(/^domain\./);
      expect(d.icon).toBeTruthy();
      expect(d.color).toMatch(/^#/);
      expect(d.routePrefix).toMatch(/^\//);
    }
  });

  it('isValidDomain validates strings', () => {
    expect(isValidDomain('flight')).toBe(true);
    expect(isValidDomain('xxx')).toBe(false);
    expect(isValidDomain('')).toBe(false);
  });

  it('getDomainDescriptor returns descriptor or throws on unknown', () => {
    expect(getDomainDescriptor('flight').key).toBe('flight');
    expect(() => getDomainDescriptor('unknown' as DomainKey)).toThrow();
  });
});
