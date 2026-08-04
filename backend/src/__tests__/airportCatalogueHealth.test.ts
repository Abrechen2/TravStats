import { AIRPORT_CATALOGUE } from '../config/constants';

// The seeding service pulls in the CSV importer and https at module load;
// only the pure predicate is under test here.
jest.mock('../db', () => ({ prisma: { airport: { count: jest.fn() } } }));

import { prisma } from '../db';
import { isAirportCatalogueHealthy } from '../services/airportSeedingService';

const mockCount = prisma.airport.count as unknown as jest.Mock;

describe('isAirportCatalogueHealthy', () => {
  beforeEach(() => mockCount.mockReset());

  it('calls an empty catalogue unhealthy', async () => {
    mockCount.mockResolvedValue(0);
    await expect(isAirportCatalogueHealthy()).resolves.toBe(false);
  });

  it('calls the interrupted-seed fragment unhealthy', async () => {
    // 57 rows is what an aborted first-boot seed actually left behind.
    mockCount.mockResolvedValue(57);
    await expect(isAirportCatalogueHealthy()).resolves.toBe(false);
  });

  it('calls a complete OurAirports import healthy', async () => {
    mockCount.mockResolvedValue(18364);
    await expect(isAirportCatalogueHealthy()).resolves.toBe(true);
  });

  it('treats exactly the threshold as healthy, one below as not', async () => {
    mockCount.mockResolvedValue(AIRPORT_CATALOGUE.MIN_HEALTHY_COUNT);
    await expect(isAirportCatalogueHealthy()).resolves.toBe(true);
    mockCount.mockResolvedValue(AIRPORT_CATALOGUE.MIN_HEALTHY_COUNT - 1);
    await expect(isAirportCatalogueHealthy()).resolves.toBe(false);
  });
});
