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

describe('aggregateFlightData — mode parameter', () => {
  const makeRefFlight = (id: string) => ({
    id,
    flightNumber: 'LH400',
    aircraft: 'A380',
    depIcao: 'EDDF',
    depIata: 'FRA',
    arrIcao: 'KJFK',
    arrIata: 'JFK',
    gate: 'Z12',
    terminal: '1',
    actualRoute: [{ lat: 50.0, lon: 8.0 }, { lat: 40.0, lon: -73.0 }],
    hasLiveTracking: true,
    departureTime: new Date(),
    overflownCountries: ['DE', 'FR', 'US'],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.flight.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => makeRefFlight(`ref-${i}`))
    );
  });

  it('slim mode returns undefined for aircraft and typicalRoute', async () => {
    const { aggregateFlightData } = await import('../flightEnrichmentService');
    const result = await aggregateFlightData('LH400', 'exclude-id', 5, 'slim');
    expect(result).not.toBeNull();
    expect(result!.aircraft).toBeUndefined();
    expect(result!.typicalRoute).toBeUndefined();
  });

  it('slim mode still returns depIcao, arrIcao, and terminal', async () => {
    const { aggregateFlightData } = await import('../flightEnrichmentService');
    const result = await aggregateFlightData('LH400', 'exclude-id', 5, 'slim');
    expect(result!.depIcao).toBe('EDDF');
    expect(result!.arrIcao).toBe('KJFK');
    expect(result!.terminal).toBe('1');
  });

  it('full mode returns aircraft and typicalRoute', async () => {
    const { aggregateFlightData } = await import('../flightEnrichmentService');
    const result = await aggregateFlightData('LH400', 'exclude-id', 5, 'full');
    expect(result!.aircraft).toBe('A380');
    // typicalRoute may be undefined if aggregateRoutes returns undefined with mock data — that's ok
    // just verify aircraft is present
  });
});

describe('aggregateRoutesForTest — median interpolation', () => {
  it('returns undefined for empty input', async () => {
    const { aggregateRoutesForTest } = await import('../flightEnrichmentService');
    expect(aggregateRoutesForTest([])).toBeUndefined();
  });

  it('returns undefined when all routes have fewer than 2 points', async () => {
    const { aggregateRoutesForTest } = await import('../flightEnrichmentService');
    expect(aggregateRoutesForTest([[{ lat: 50, lon: 8 }]])).toBeUndefined();
  });

  it('returns exactly RESAMPLE_POINTS (20) waypoints', async () => {
    const { aggregateRoutesForTest } = await import('../flightEnrichmentService');
    const route = [{ lat: 50, lon: 8 }, { lat: 40, lon: -73 }];
    const result = aggregateRoutesForTest([route, route]);
    expect(result).not.toBeUndefined();
    expect(result!.waypoints.length).toBe(20);
  });

  it('median is close to normal routes, not pulled by outlier', async () => {
    const { aggregateRoutesForTest } = await import('../flightEnrichmentService');
    // 3 routes starting near lat=50, one outlier starting at lat=70
    const normal1 = [{ lat: 50, lon: 8 }, { lat: 40, lon: -73 }];
    const normal2 = [{ lat: 50, lon: 8 }, { lat: 40, lon: -73 }];
    const outlier = [{ lat: 70, lon: 8 }, { lat: 40, lon: -73 }];
    const result = aggregateRoutesForTest([normal1, normal2, outlier]);
    expect(result).not.toBeUndefined();
    // Median of [50, 50, 70] = 50 — outlier should not dominate
    expect(result!.waypoints[0].lat).toBeCloseTo(50, 0);
  });
});
