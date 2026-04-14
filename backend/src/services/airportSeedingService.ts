import { prisma } from '../db';
import logger from '../utils/logger';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import https from 'https';

interface CSVAirport {
  id: string;
  ident: string;
  type: string;
  name: string;
  latitude_deg: string;
  longitude_deg: string;
  elevation_ft: string;
  continent: string;
  iso_country: string;
  iso_region: string;
  municipality: string;
  scheduled_service: string;
  gps_code: string;
  iata_code: string;
  local_code: string;
  home_link: string;
  wikipedia_link: string;
  keywords: string;
}

let seedingInProgress = false;

async function downloadCSV(url: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        file.close();
        fs.unlinkSync(destination);
        https.get(response.headers.location!, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', (err) => {
          fs.unlinkSync(destination);
          reject(err);
        });
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }
    }).on('error', (err) => {
      fs.unlinkSync(destination);
      reject(err);
    });
  });
}

/**
 * Update seeding status in database
 */
async function updateSeedingStatus(
  statusId: string,
  updates: {
    status?: 'pending' | 'running' | 'completed' | 'failed';
    processedAirports?: number;
    estimatedTimeRemaining?: number | null;
    error?: string | null;
    completedAt?: Date | null;
  }
): Promise<void> {
  try {
    await prisma.airportSeedingStatus.update({
      where: { id: statusId },
      data: {
        ...updates,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    logger.error({
      operation: 'update_seeding_status_error',
      message: 'Failed to update seeding status',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}

/**
 * Calculate estimated time remaining based on current progress
 */
function calculateEstimatedTime(
  processed: number,
  total: number,
  elapsedSeconds: number
): number | null {
  if (processed < 100) {
    // Not enough data for reliable estimate
    return null;
  }

  if (processed >= total) {
    return 0;
  }

  const rate = processed / elapsedSeconds; // airports per second
  const remaining = total - processed;
  const estimatedSeconds = Math.ceil(remaining / rate);

  // Clamp between 10 seconds and 30 minutes
  return Math.max(10, Math.min(estimatedSeconds, 30 * 60));
}

/**
 * Asynchronously seed airports from CSV with progress tracking
 */
async function seedAirportsFromCSVAsync(statusId: string): Promise<void> {
  const startTime = Date.now();

  try {
    logger.info({
      operation: 'seed_airports_async_start',
      message: 'Starting async airport import from CSV',
      context: { statusId },
    });

    const csvPath = path.join(__dirname, '..', '..', 'airports.csv');

    // Download CSV if needed
    if (!fs.existsSync(csvPath)) {
      await updateSeedingStatus(statusId, {
        status: 'running',
        processedAirports: 0,
        estimatedTimeRemaining: null,
      });

      logger.info({
        operation: 'seed_airports_download',
        message: 'CSV file not found, downloading from OurAirports.com',
      });

      const downloadUrl = 'https://davidmegginson.github.io/ourairports-data/airports.csv';

      try {
        await downloadCSV(downloadUrl, csvPath);
        logger.info({
          operation: 'seed_airports_download_success',
          message: 'CSV file downloaded successfully',
        });
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        logger.error({
          operation: 'seed_airports_download_error',
          message: 'Failed to download CSV file',
          error: { message: errorMsg },
        });
        throw new Error(`Fehler beim Herunterladen der CSV-Datei: ${errorMsg}`);
      }
    }

    // Parse CSV
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const records: CSVAirport[] = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });

    logger.info({
      operation: 'seed_airports_csv_parsed',
      message: `Found ${records.length} airports in CSV`,
      context: { recordCount: records.length },
    });

    // Filter airports. We include `closed` so that permanently closed
    // commercial airports (e.g. Berlin Tegel TXL, Denver Stapleton) are still
    // pickable for historical flights. Without them, users cannot log any
    // pre-closure flights. We also drop the `scheduled_service === 'yes'`
    // filter: `closed` airports always have `scheduled_service = 'no'`.
    const filteredAirports = records.filter((airport) => {
      if (!['large_airport', 'medium_airport', 'closed'].includes(airport.type)) {
        return false;
      }
      if (!airport.latitude_deg || !airport.longitude_deg) {
        return false;
      }
      // Closed airports in OurAirports data don't lose their IATA/ICAO — we
      // still require a code so the airport is addressable. Active airports
      // without a code are also dropped (same as before).
      if (!airport.iata_code && !airport.gps_code && !airport.ident) {
        return false;
      }
      return true;
    });

    const totalAirports = filteredAirports.length;

    // Pre-pass: collect IATA codes that belong to ACTIVE airports so we
    // don't accidentally assign them to closed ones via the keywords
    // fallback. The CSV often lists the successor airport's IATA in a
    // closed airport's keywords (e.g. THF Tempelhof has keywords
    // "BER, EDDI, THF" because BER Brandenburg replaced it).
    const activeIatas = new Set<string>();
    for (const a of filteredAirports) {
      if (a.type !== 'closed' && a.iata_code) activeIatas.add(a.iata_code.toUpperCase());
    }

    // Update total airports count
    await prisma.airportSeedingStatus.update({
      where: { id: statusId },
      data: {
        totalAirports,
        status: 'running',
        startedAt: new Date(),
      },
    });

    logger.info({
      operation: 'seed_airports_filtered',
      message: `Filtered ${totalAirports} airports`,
      context: { filteredCount: totalAirports },
    });

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let processed = 0;

    // Process airports
    for (const airport of filteredAirports) {
      try {
        // OurAirports strips iata_code / gps_code from closed airports and
        // only keeps the historical codes in the `keywords` column (e.g.
        // "TXL, EDDT, Otto Lilienthal"). Recover them so closed airports
        // remain searchable by their well-known codes.
        let iata = airport.iata_code || null;
        let icao = airport.gps_code || airport.ident || null;
        if (airport.type === 'closed' && airport.keywords) {
          const tokens = airport.keywords.split(',').map((t) => t.trim().toUpperCase());
          if (!iata) {
            // Skip 3-letter codes already used by an active airport — those
            // are typically the successor's IATA, not the closed one's.
            const iataCandidate = tokens.find(
              (t) => /^[A-Z]{3}$/.test(t) && !activeIatas.has(t)
            );
            if (iataCandidate) iata = iataCandidate;
          }
          if (!icao || (icao && !/^[A-Z]{4}$/.test(icao))) {
            const icaoCandidate = tokens.find((t) => /^[A-Z]{4}$/.test(t));
            if (icaoCandidate) icao = icaoCandidate;
          }
        }

        if (!iata && !icao) {
          skipped++;
          processed++;
          continue;
        }

        const lat = parseFloat(airport.latitude_deg);
        const lon = parseFloat(airport.longitude_deg);

        if (isNaN(lat) || isNaN(lon)) {
          skipped++;
          processed++;
          continue;
        }

        const altitude = airport.elevation_ft
          ? Math.round(parseFloat(airport.elevation_ft) * 0.3048)
          : null;

        const isClosed = airport.type === 'closed';

        // Composite uniqueness on (iata, isClosed) and (icao, isClosed) lets
        // a closed predecessor coexist with its active successor sharing the
        // same code. Look up by the (code, isClosed) pair so we don't overwrite
        // the wrong row.
        const existing = iata
          ? await prisma.airport.findFirst({ where: { iata, isClosed } })
          : await prisma.airport.findFirst({ where: { icao, isClosed } });

        const data = {
          name: airport.name,
          city: airport.municipality || null,
          country: airport.iso_country || null,
          lat,
          lon,
          altitude,
          iata,
          icao,
          isClosed,
        };

        const result = existing
          ? await prisma.airport.update({ where: { id: existing.id }, data })
          : await prisma.airport.create({ data });

        if (result.id) {
          imported++;
        } else {
          updated++;
        }

        processed++;

        // Update status every 100 airports
        if (processed % 100 === 0) {
          const elapsedSeconds = (Date.now() - startTime) / 1000;
          const estimatedTimeRemaining = calculateEstimatedTime(
            processed,
            totalAirports,
            elapsedSeconds
          );

          await updateSeedingStatus(statusId, {
            processedAirports: processed,
            estimatedTimeRemaining,
          });

          logger.debug({
            operation: 'seed_airports_progress',
            message: `Progress: ${processed}/${totalAirports} airports processed`,
            context: { processed, total: totalAirports },
          });
        }
      } catch (error: unknown) {
        logger.error({
          operation: 'seed_airports_airport_error',
          message: `Error processing airport ${airport.name}`,
          context: { airportName: airport.name },
          error: { message: error instanceof Error ? error.message : 'Unknown error' },
        });
        skipped++;
        processed++;
      }
    }

    // Final update
    const totalCount = await prisma.airport.count();
    await updateSeedingStatus(statusId, {
      status: 'completed',
      processedAirports: processed,
      estimatedTimeRemaining: 0,
      completedAt: new Date(),
    });

    logger.info({
      operation: 'seed_airports_complete',
      message: 'Airport import completed',
      context: { imported, updated, skipped, total: imported + updated, totalCount },
    });

    seedingInProgress = false;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await updateSeedingStatus(statusId, {
      status: 'failed',
      error: errorMessage,
      completedAt: new Date(),
    });

    logger.error({
      operation: 'seed_airports_failed',
      message: 'Airport seeding failed',
      error: {
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      },
    });

    seedingInProgress = false;
    throw error;
  }
}

/**
 * Start airport seeding asynchronously
 * Returns the status ID
 */
export async function startAirportSeeding(): Promise<string> {
  if (seedingInProgress) {
    // Check if there's an existing running status
    const existing = await prisma.airportSeedingStatus.findFirst({
      where: { status: 'running' },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return existing.id;
    }
  }

  // Check if airports already exist
  const airportCount = await prisma.airport.count();
  if (airportCount > 0) {
    // Create a completed status if airports already exist
    try {
      const status = await prisma.airportSeedingStatus.create({
        data: {
          status: 'completed',
          totalAirports: airportCount,
          processedAirports: airportCount,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
      return status.id;
    } catch (error: unknown) {
      // If another process already created a status, return existing one
      const prismaError = error as { code?: string };
      if (prismaError.code === 'P2002') {
        const existing = await prisma.airportSeedingStatus.findFirst({
          orderBy: { createdAt: 'desc' },
        });
        if (existing) return existing.id;
      }
      throw error;
    }
  }

  // Create new seeding status with race condition protection
  let status;
  try {
    status = await prisma.airportSeedingStatus.create({
      data: {
        status: 'pending',
        totalAirports: 0,
        processedAirports: 0,
      },
    });
  } catch (error: unknown) {
    // If another process already created a status, check for existing pending/running status
    const prismaError = error as { code?: string; message?: string };
    if (prismaError.code === 'P2002' || prismaError.message?.includes('unique')) {
      const existing = await prisma.airportSeedingStatus.findFirst({
        where: {
          status: { in: ['pending', 'running'] },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        return existing.id;
      }
    }
    throw error;
  }

  // status.id available if needed for status tracking in the future
  seedingInProgress = true;

  // Start seeding asynchronously (don't await)
  seedAirportsFromCSVAsync(status.id).catch((error) => {
    logger.error({
      operation: 'start_airport_seeding_error',
      message: 'Failed to start airport seeding',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  });

  return status.id;
}

/**
 * Get current seeding status
 */
export async function getSeedingStatus(): Promise<{
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  estimatedSecondsRemaining?: number;
  totalAirports?: number;
  processedAirports?: number;
  error?: string;
} | null> {
  // Check if airports already exist (seeding not needed)
  const airportCount = await prisma.airport.count();
  if (airportCount > 0) {
    // Check if there's a completed status
    const completed = await prisma.airportSeedingStatus.findFirst({
      where: { status: 'completed' },
      orderBy: { createdAt: 'desc' },
    });

    if (completed) {
      return {
        status: 'completed',
        progress: 1,
        estimatedSecondsRemaining: 0,
        totalAirports: completed.totalAirports,
        processedAirports: completed.processedAirports,
      };
    }

    // Airports exist but no status record - seeding was done before this feature
    return null;
  }

  // Get latest status
  const latestStatus = await prisma.airportSeedingStatus.findFirst({
    orderBy: { createdAt: 'desc' },
  });

  if (!latestStatus) {
    return null;
  }

  const progress =
    latestStatus.totalAirports > 0
      ? latestStatus.processedAirports / latestStatus.totalAirports
      : 0;

  return {
    status: latestStatus.status as 'pending' | 'running' | 'completed' | 'failed',
    progress,
    estimatedSecondsRemaining: latestStatus.estimatedTimeRemaining ?? undefined,
    totalAirports: latestStatus.totalAirports,
    processedAirports: latestStatus.processedAirports,
    error: latestStatus.error ?? undefined,
  };
}

/**
 * Check if seeding is currently in progress
 */
export function isSeedingInProgress(): boolean {
  return seedingInProgress;
}
