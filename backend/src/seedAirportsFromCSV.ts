import { PrismaClient } from '@prisma/client';
import logger from './utils/logger';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import https from 'https';

const prisma = new PrismaClient();

import { admitsAirport } from './shared/antarcticAirfields';
import { normalizeAirportName } from './shared/airportName';

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

export interface SeedAirportsOptions {
  /**
   * When `true`, only `closed` OurAirports records are processed. Used by
   * the closed-airport backfill on existing installs whose initial seed
   * (pre-1.4) imported only active airports. Active airports are skipped
   * to avoid ~5000 redundant upserts on every container boot.
   */
  closedOnly?: boolean;
}

/**
 * Whether a failure is the CSV colliding with itself rather than a fault.
 *
 * Prisma reports a unique-constraint violation as P2002. In this seeder that
 * means a DIFFERENT airport already holds the code — the source data contains
 * several distinct offshore helidecks sharing one ICAO — so skipping the row is
 * both correct and always the same decision.
 *
 * Exported for the test: the shape of a Prisma error is the thing that can
 * change under us, and a startup that logs errors for expected data teaches
 * people to ignore the log (Forgejo #3).
 */
export function isDuplicateCodeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export async function seedAirportsFromCSV(options: SeedAirportsOptions = {}) {
  const { closedOnly = false } = options;
  logger.info({
    operation: 'seed_airports_start',
    message: closedOnly
      ? 'Starting closed-only airport backfill from CSV'
      : 'Starting airport import from CSV',
    context: { closedOnly },
  });

  const csvPath = path.join(__dirname, '..', 'airports.csv');

  if (!fs.existsSync(csvPath)) {
    logger.info({ operation: 'seed_airports_download', message: 'CSV file not found, downloading from OurAirports.com' });
    const downloadUrl = 'https://davidmegginson.github.io/ourairports-data/airports.csv';

    try {
      await downloadCSV(downloadUrl, csvPath);
      logger.info({ operation: 'seed_airports_download_success', message: 'CSV file downloaded successfully' });
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

  // Include `closed` so permanently closed commercial airports (e.g. Berlin
  // Tegel TXL, Denver Stapleton) remain selectable for historical flights.
  // Drop the `scheduled_service === 'yes'` filter — closed airports always
  // have `scheduled_service = 'no'` in the OurAirports CSV.
  const filteredAirports = records.filter((a) => admitsAirport(a, { closedOnly }));

  logger.info({
    operation: 'seed_airports_filtered',
    message: `Filtered ${filteredAirports.length} airports`,
    context: { filteredCount: filteredAirports.length },
  });

  // Pre-pass: collect IATA codes that belong to ACTIVE airports so we don't
  // accidentally assign them to closed ones via the keywords fallback. The
  // CSV often lists the successor airport's IATA in a closed airport's
  // keywords (e.g. THF Tempelhof has keywords "BER, EDDI, THF" because BER
  // Brandenburg replaced it). In closed-only mode `filteredAirports` has no
  // active rows, so iterate the unfiltered records to keep the conflict
  // check working.
  const activeIatas = new Set<string>();
  for (const a of records) {
    if (
      (a.type === 'large_airport' || a.type === 'medium_airport') &&
      a.iata_code
    ) {
      activeIatas.add(a.iata_code.toUpperCase());
    }
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  // Rows the CSV itself makes impossible: a distinct airport already holds
  // this code. Counted apart from other skips so the summary says WHY.
  let duplicateCodes = 0;

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
          const threeLetter = tokens.filter((t) => /^[A-Z]{3}$/.test(t));
          // If only one 3-letter code is present it's almost certainly the
          // closed airport's own historical IATA (e.g. Munich-Riem keywords
          // "EDDM, MUC, XMUC" → MUC is the reused code). If multiple are
          // present the first is usually the successor (e.g. Tempelhof
          // "BER, EDDI, THF" — BER is Brandenburg, THF is the closed one),
          // so prefer the candidate not used by an active airport.
          if (threeLetter.length === 1) {
            iata = threeLetter[0];
          } else if (threeLetter.length > 1) {
            const nonActive = threeLetter.find((t) => !activeIatas.has(t));
            if (nonActive) iata = nonActive;
          }
        }
        if (!icao || (icao && !/^[A-Z]{4}$/.test(icao))) {
          const icaoCandidate = tokens.find((t) => /^[A-Z]{4}$/.test(t));
          if (icaoCandidate) icao = icaoCandidate;
        }
      }

      if (!iata && !icao) {
        skipped++;
        continue;
      }

      const lat = parseFloat(airport.latitude_deg);
      const lon = parseFloat(airport.longitude_deg);

      if (isNaN(lat) || isNaN(lon)) {
        skipped++;
        continue;
      }

      const altitude = airport.elevation_ft
        ? Math.round(parseFloat(airport.elevation_ft) * 0.3048)
        : null;

      const isClosed = airport.type === 'closed';

      // Composite uniqueness on (iata, isClosed) and (icao, isClosed) lets a
      // closed predecessor coexist with its active successor sharing the
      // same code. Look up by the (code, isClosed) pair so we don't
      // overwrite the wrong row.
      const existing = iata
        ? await prisma.airport.findFirst({ where: { iata, isClosed } })
        : await prisma.airport.findFirst({ where: { icao, isClosed } });

      // Same invariant as the ship/port seeds: a manually added airport
      // (#191) is never overwritten by a CSV re-seed.
      if (existing?.isUserAdded) {
        skipped++;
        continue;
      }

      const data = {
        name: normalizeAirportName(airport.name),
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

      // Progress anzeigen
      if ((imported + updated) % 100 === 0) {
        logger.debug({
          operation: 'seed_airports_progress',
          message: `Progress: ${imported + updated} airports processed`,
          context: { processed: imported + updated },
        });
      }

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // A unique-constraint clash here is DATA, not a fault.
      //
      // Forgejo #3: a fresh start logged error-level lines for a handful of
      // offshore helidecks — "Error processing airport SSCV Hermod Helideck",
      // unique constraint failed on (icao, is_closed). The source CSV genuinely
      // contains several distinct platforms sharing one ICAO. The row is looked
      // up by its IATA pair, is not found, and the insert then collides on the
      // ICAO pair of a different airport.
      //
      // Skipping is the correct outcome and always the same one, so it is
      // logged as the routine event it is. Updating instead would overwrite a
      // DIFFERENT airport with this one's details, which is worse than not
      // importing an unmanned helideck.
      //
      // Anything else still shouts: a fresh startup with red lines in it
      // teaches people to ignore red lines.
      if (isDuplicateCodeError(error)) {
        duplicateCodes++;
        logger.debug({
          operation: 'seed_airports_duplicate_code',
          message: `Skipped ${airport.name} — its code is already taken by another airport`,
          context: { airportName: airport.name, iata: airport.iata_code, icao: airport.ident },
        });
      } else {
        logger.error({
          operation: 'seed_airports_airport_error',
          message: `Error processing airport ${airport.name}`,
          context: { airportName: airport.name },
          error: { message: errorMessage },
        });
      }
      skipped++;
    }
  }

  logger.info({
    operation: 'seed_airports_complete',
    message: 'Airport import completed',
    context: { imported, updated, skipped, duplicateCodes, total: imported + updated },
  });

  // Zeige Gesamtanzahl in DB
  const totalCount = await prisma.airport.count();
  logger.info({
    operation: 'seed_airports_total',
    message: `Total airports in database: ${totalCount}`,
    context: { totalCount },
  });
}

// Direct CLI invocation: `npm run seed:airports:csv` runs this file as a
// standalone process. When imported as a module (e.g. by the closed-airport
// backfill script), the `seedAirportsFromCSV` function is called explicitly
// instead and this block is skipped.
if (require.main === module) {
  seedAirportsFromCSV()
    .catch((error) => {
      logger.error({
        operation: 'seed_airports_failed',
        message: 'Airport seeding failed',
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
}
