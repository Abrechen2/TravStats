#!/usr/bin/env node
/**
 * Backfill closed airports for installs whose initial seed (pre-1.4)
 * imported only active airports. Idempotent — runs the closed-only seed
 * pass when:
 *   - active airports already exist (initial seed succeeded), AND
 *   - no closed airports are present yet.
 *
 * Skips silently otherwise so the entrypoint can call it on every boot.
 */

import { PrismaClient } from '@prisma/client';
import { seedAirportsFromCSV } from '../seedAirportsFromCSV';
import logger from '../utils/logger';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.$connect();
  const [activeCount, closedCount] = await Promise.all([
    prisma.airport.count({ where: { isClosed: false } }),
    prisma.airport.count({ where: { isClosed: true } }),
  ]);

  if (activeCount === 0) {
    logger.info({
      operation: 'backfill_closed_airports_skip',
      message: 'No active airports yet — initial seed has not run, skipping closed-airport backfill',
      context: { activeCount, closedCount },
    });
    return;
  }

  if (closedCount > 0) {
    logger.info({
      operation: 'backfill_closed_airports_skip',
      message: 'Closed airports already present, no backfill needed',
      context: { activeCount, closedCount },
    });
    return;
  }

  logger.info({
    operation: 'backfill_closed_airports_start',
    message: 'Backfilling closed airports from OurAirports CSV',
    context: { activeCount, closedCount },
  });

  await seedAirportsFromCSV({ closedOnly: true });

  const newClosedCount = await prisma.airport.count({ where: { isClosed: true } });
  logger.info({
    operation: 'backfill_closed_airports_complete',
    message: 'Closed-airport backfill completed',
    context: { closedCount: newClosedCount },
  });
}

main()
  .catch((error) => {
    logger.error({
      operation: 'backfill_closed_airports_failed',
      message: 'Closed-airport backfill failed',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
