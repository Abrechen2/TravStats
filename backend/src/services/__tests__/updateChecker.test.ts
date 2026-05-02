import { isUpdateAvailable } from '../updateChecker';

describe('isUpdateAvailable', () => {
  it('returns true when latest is a higher patch', () => {
    expect(isUpdateAvailable('1.2.0', '1.2.1')).toBe(true);
  });

  it('returns true when latest is a higher minor', () => {
    expect(isUpdateAvailable('1.2.0', '1.3.0')).toBe(true);
  });

  it('returns true when latest is a higher major', () => {
    expect(isUpdateAvailable('1.2.0', '2.0.0')).toBe(true);
  });

  it('returns false when latest equals current', () => {
    expect(isUpdateAvailable('1.2.0', '1.2.0')).toBe(false);
  });

  it('returns false when latest is older', () => {
    expect(isUpdateAvailable('1.2.0', '1.1.5')).toBe(false);
  });

  it('treats current rc/beta as if the stable target is already running', () => {
    expect(isUpdateAvailable('1.2.0-rc.3', '1.2.0')).toBe(false);
  });

  it('still detects an update when on rc and a NEWER stable ships', () => {
    expect(isUpdateAvailable('1.2.0-rc.3', '1.2.1')).toBe(true);
  });

  it('handles a leading v in either argument', () => {
    expect(isUpdateAvailable('v1.2.0', 'v1.3.0')).toBe(true);
  });

  it('rejects malformed versions safely', () => {
    expect(isUpdateAvailable('not-a-version', '1.2.0')).toBe(false);
    expect(isUpdateAvailable('1.2.0', 'whatever')).toBe(false);
  });
});
