jest.mock('../../db', () => ({
  prisma: {
    userSettings: { findUnique: jest.fn() },
    flight: { findMany: jest.fn() },
  },
}));

import { getEnrichmentMode } from '../flightEnrichmentService';
import { prisma } from '../../db';

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

describe('findEnrichmentCandidates — prisma filter', () => {
  const mockUserSettings = {
    historicalEnrichmentEnabled: true,
    historicalEnrichmentMinConfidence: 60,
    historicalEnrichmentMaxPerDay: 50,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.userSettings.findUnique as jest.Mock).mockResolvedValue(mockUserSettings);
    (prisma.flight.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('returns empty array when enrichment is disabled', async () => {
    (prisma.userSettings.findUnique as jest.Mock).mockResolvedValue({
      ...mockUserSettings,
      historicalEnrichmentEnabled: false,
    });
    const { findEnrichmentCandidates } = await import('../flightEnrichmentService');
    const result = await findEnrichmentCandidates('user-1');
    expect(result).toEqual([]);
    expect(prisma.flight.findMany).not.toHaveBeenCalled();
  });

  it('excludes applied, pending, and rejected in the NOT filter', async () => {
    const { findEnrichmentCandidates } = await import('../flightEnrichmentService');
    await findEnrichmentCandidates('user-1');

    expect(prisma.flight.findMany).toHaveBeenCalledTimes(1);
    const callArg = (prisma.flight.findMany as jest.Mock).mock.calls[0][0];
    const statusFilter = callArg?.where?.NOT?.pendingUpdates?.some?.status?.in;
    expect(statusFilter).toEqual(expect.arrayContaining(['applied', 'pending', 'rejected']));
  });
});
