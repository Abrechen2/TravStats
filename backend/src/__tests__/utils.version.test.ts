import { describe, it, expect } from '@jest/globals';
import { stripPrereleaseSuffix } from '../utils/version';

describe('version utils', () => {
  describe('stripPrereleaseSuffix', () => {
    it('strips -rc.N suffix', () => {
      expect(stripPrereleaseSuffix('1.4.0-rc.1')).toBe('1.4.0');
      expect(stripPrereleaseSuffix('1.4.0-rc.42')).toBe('1.4.0');
    });

    it('strips -security-rc.N suffix', () => {
      expect(stripPrereleaseSuffix('1.4.1-security-rc.1')).toBe('1.4.1');
    });

    it('strips -beta.N suffix', () => {
      expect(stripPrereleaseSuffix('2.0.0-beta.8')).toBe('2.0.0');
    });

    it('strips -alpha.N suffix', () => {
      expect(stripPrereleaseSuffix('0.5.0-alpha.3')).toBe('0.5.0');
    });

    it('leaves a clean release version untouched', () => {
      expect(stripPrereleaseSuffix('1.4.0')).toBe('1.4.0');
      expect(stripPrereleaseSuffix('10.20.30')).toBe('10.20.30');
    });

    it('leaves "unknown" untouched', () => {
      expect(stripPrereleaseSuffix('unknown')).toBe('unknown');
    });

    it('does not strip suffixes without trailing .N', () => {
      // Defensive: only strip when the suffix matches the deploy convention.
      // Avoid silently swallowing arbitrary "-rc"-prefixed labels.
      expect(stripPrereleaseSuffix('1.4.0-rc')).toBe('1.4.0-rc');
      expect(stripPrereleaseSuffix('1.4.0-custom')).toBe('1.4.0-custom');
    });

    it('only strips a trailing match, not an embedded one', () => {
      expect(stripPrereleaseSuffix('1.4.0-rc.1+meta')).toBe('1.4.0-rc.1+meta');
    });
  });
});
