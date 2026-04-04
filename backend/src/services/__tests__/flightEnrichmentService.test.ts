import { getEnrichmentMode } from '../flightEnrichmentService';

describe('getEnrichmentMode', () => {
  it('returns full for a flight 6 months ago', () => {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    expect(getEnrichmentMode(sixMonthsAgo)).toBe('full');
  });

  it('returns full for a flight just under 1 year ago', () => {
    const justUnder = new Date();
    justUnder.setFullYear(justUnder.getFullYear() - 1);
    justUnder.setDate(justUnder.getDate() + 1);
    expect(getEnrichmentMode(justUnder)).toBe('full');
  });

  it('returns slim for a flight 2 years ago', () => {
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    expect(getEnrichmentMode(twoYearsAgo)).toBe('slim');
  });

  it('returns slim for a flight 5 years ago', () => {
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    expect(getEnrichmentMode(fiveYearsAgo)).toBe('slim');
  });
});
