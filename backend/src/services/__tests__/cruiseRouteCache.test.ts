import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Mock prisma + seaRouter BEFORE importing the module under test so the
// mocks replace the real implementations.
jest.mock('../../db', () => ({
  prisma: {
    cruiseRouteCache: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

jest.mock('../seaRouter', () => ({
  computeSeaRoute: jest.fn(),
}));

// eslint-disable-next-line import/first
import { prisma } from '../../db';
// eslint-disable-next-line import/first
import { computeSeaRoute } from '../seaRouter';
// eslint-disable-next-line import/first
import { CACHE_VERSION, getOrComputeSeaRoute } from '../cruiseRouteCache';

const findUnique = prisma.cruiseRouteCache.findUnique as jest.MockedFunction<
  typeof prisma.cruiseRouteCache.findUnique
>;
const upsert = prisma.cruiseRouteCache.upsert as jest.MockedFunction<
  typeof prisma.cruiseRouteCache.upsert
>;
const compute = computeSeaRoute as jest.MockedFunction<typeof computeSeaRoute>;

const portA = { lat: 41.38, lon: 2.17 }; // Barcelona
const portB = { lat: 42.1, lon: 11.8 }; // Civitavecchia

const stubRoute = {
  type: 'LineString' as const,
  coordinates: [
    [2.17, 41.38],
    [8.0, 41.9],
    [11.8, 42.1],
  ] as [number, number][],
};

describe('cruiseRouteCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the cached geometry on hit without calling A*', async () => {
    findUnique.mockResolvedValueOnce({
      depPortId: 1,
      arrPortId: 2,
      geometry: stubRoute,
      computedAt: new Date(),
      version: CACHE_VERSION,
    });

    const result = await getOrComputeSeaRoute(1, 2, portA, portB);

    expect(result).toEqual(stubRoute);
    expect(compute).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('runs A* on cache miss and upserts the result', async () => {
    findUnique.mockResolvedValueOnce(null);
    compute.mockResolvedValueOnce(stubRoute);
    upsert.mockResolvedValueOnce({
      depPortId: 1,
      arrPortId: 2,
      geometry: stubRoute,
      computedAt: new Date(),
      version: CACHE_VERSION,
    });

    const result = await getOrComputeSeaRoute(1, 2, portA, portB);

    expect(result).toEqual(stubRoute);
    expect(compute).toHaveBeenCalledWith(portA, portB);
    expect(upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = upsert.mock.calls[0][0];
    expect(upsertArgs.where.depPortId_arrPortId).toEqual({ depPortId: 1, arrPortId: 2 });
  });

  it('recomputes when cached version is stale', async () => {
    findUnique.mockResolvedValueOnce({
      depPortId: 1,
      arrPortId: 2,
      geometry: stubRoute,
      computedAt: new Date(),
      version: CACHE_VERSION - 1,
    });
    compute.mockResolvedValueOnce(stubRoute);
    upsert.mockResolvedValueOnce({
      depPortId: 1,
      arrPortId: 2,
      geometry: stubRoute,
      computedAt: new Date(),
      version: CACHE_VERSION,
    });

    await getOrComputeSeaRoute(1, 2, portA, portB);

    expect(compute).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('stores the row under the smaller port id and reverses on opposite-direction lookup', async () => {
    // First call: B → A (port 2 → port 1). Canonical stored direction is 1 → 2.
    findUnique.mockResolvedValueOnce(null);
    compute.mockResolvedValueOnce(stubRoute);
    upsert.mockResolvedValueOnce({
      depPortId: 1,
      arrPortId: 2,
      geometry: stubRoute,
      computedAt: new Date(),
      version: CACHE_VERSION,
    });

    const result = await getOrComputeSeaRoute(2, 1, portB, portA);

    // Stored row must use dep=1, arr=2 regardless of query direction.
    expect(upsert.mock.calls[0][0].where.depPortId_arrPortId).toEqual({
      depPortId: 1,
      arrPortId: 2,
    });
    // Compute ran in the canonical direction (portA → portB).
    expect(compute).toHaveBeenCalledWith(portA, portB);
    // The returned geometry is the stored one reversed.
    expect(result).toEqual({
      type: 'LineString',
      coordinates: [...stubRoute.coordinates].reverse(),
    });
  });

  it('does not persist when A* returns null (landlocked port)', async () => {
    findUnique.mockResolvedValueOnce(null);
    compute.mockResolvedValueOnce(null);

    const result = await getOrComputeSeaRoute(1, 2, portA, portB);

    expect(result).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('recomputes when the stored geometry JSON is malformed', async () => {
    findUnique.mockResolvedValueOnce({
      depPortId: 1,
      arrPortId: 2,
      geometry: { type: 'NotALineString' } as unknown,
      computedAt: new Date(),
      version: CACHE_VERSION,
    });
    compute.mockResolvedValueOnce(stubRoute);
    upsert.mockResolvedValueOnce({
      depPortId: 1,
      arrPortId: 2,
      geometry: stubRoute,
      computedAt: new Date(),
      version: CACHE_VERSION,
    });

    const result = await getOrComputeSeaRoute(1, 2, portA, portB);

    expect(compute).toHaveBeenCalled();
    expect(result).toEqual(stubRoute);
  });
});
