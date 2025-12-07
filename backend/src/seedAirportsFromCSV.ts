import { PrismaClient } from '@prisma/client';
import logger from './utils/logger';
import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import https from 'https';

const prisma = new PrismaClient();

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

async function seedAirportsFromCSV() {
  console.log('🛫 Beginne Import der Flughäfen aus CSV...');
  logger.info({ operation: 'seed_airports_start', message: 'Starting airport import from CSV' });

  const csvPath = path.join(__dirname, '..', 'airports.csv');

  if (!fs.existsSync(csvPath)) {
    console.log('📥 CSV-Datei nicht gefunden, lade von OurAirports.com herunter...');
    logger.info({ operation: 'seed_airports_download', message: 'CSV file not found, downloading from OurAirports.com' });
    const downloadUrl = 'https://davidmegginson.github.io/ourairports-data/airports.csv';

    try {
      await downloadCSV(downloadUrl, csvPath);
      console.log('✅ CSV-Datei erfolgreich heruntergeladen');
      logger.info({ operation: 'seed_airports_download_success', message: 'CSV file downloaded successfully' });
    } catch (error: any) {
      logger.error({
        operation: 'seed_airports_download_error',
        message: 'Failed to download CSV file',
        error: { message: error.message },
      });
      throw new Error(`Fehler beim Herunterladen der CSV-Datei: ${error.message}`);
    }
  }

  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const records: CSVAirport[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
  });

  console.log(`📊 ${records.length} Flughäfen in CSV gefunden`);
  logger.info({
    operation: 'seed_airports_csv_parsed',
    message: `Found ${records.length} airports in CSV`,
    context: { recordCount: records.length },
  });

  // Filtere nur große und mittlere Flughäfen mit scheduled service
  const filteredAirports = records.filter((airport) => {
    // Nur large_airport und medium_airport
    if (!['large_airport', 'medium_airport'].includes(airport.type)) {
      return false;
    }

    // Nur mit scheduled service
    if (airport.scheduled_service !== 'yes') {
      return false;
    }

    // Muss Koordinaten haben
    if (!airport.latitude_deg || !airport.longitude_deg) {
      return false;
    }

    return true;
  });

  console.log(`✅ ${filteredAirports.length} Flughäfen gefiltert (large + medium mit scheduled service)`);
  logger.info({
    operation: 'seed_airports_filtered',
    message: `Filtered ${filteredAirports.length} airports`,
    context: { filteredCount: filteredAirports.length },
  });

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const airport of filteredAirports) {
    try {
      // IATA oder ICAO muss vorhanden sein
      const iata = airport.iata_code || null;
      const icao = airport.gps_code || airport.ident || null;

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
        ? Math.round(parseFloat(airport.elevation_ft) * 0.3048) // Feet zu Meter
        : null;

      // Upsert: Update wenn vorhanden, sonst create
      const whereCondition = iata
        ? { iata }
        : { icao: icao! };

      const result = await prisma.airport.upsert({
        where: whereCondition,
        update: {
          name: airport.name,
          city: airport.municipality || null,
          country: airport.iso_country || null,
          lat,
          lon,
          altitude,
          iata,
          icao,
        },
        create: {
          name: airport.name,
          city: airport.municipality || null,
          country: airport.iso_country || null,
          lat,
          lon,
          altitude,
          iata,
          icao,
        },
      });

      if (result.id) {
        imported++;
      } else {
        updated++;
      }

      // Progress anzeigen
      if ((imported + updated) % 100 === 0) {
        console.log(`📍 Fortschritt: ${imported + updated} Flughäfen verarbeitet...`);
        logger.debug({
          operation: 'seed_airports_progress',
          message: `Progress: ${imported + updated} airports processed`,
          context: { processed: imported + updated },
        });
      }

    } catch (error: any) {
      console.error(`❌ Fehler bei Flughafen ${airport.name}:`, error.message);
      logger.error({
        operation: 'seed_airports_airport_error',
        message: `Error processing airport ${airport.name}`,
        context: { airportName: airport.name },
        error: { message: error.message },
      });
      skipped++;
    }
  }

  console.log('\n✨ Import abgeschlossen!');
  console.log(`✅ Importiert/Aktualisiert: ${imported + updated}`);
  console.log(`⏭️  Übersprungen: ${skipped}`);
  logger.info({
    operation: 'seed_airports_complete',
    message: 'Airport import completed',
    context: { imported, updated, skipped, total: imported + updated },
  });

  // Zeige Gesamtanzahl in DB
  const totalCount = await prisma.airport.count();
  console.log(`📊 Gesamt in DB: ${totalCount} Flughäfen`);
  logger.info({
    operation: 'seed_airports_total',
    message: `Total airports in database: ${totalCount}`,
    context: { totalCount },
  });
}

seedAirportsFromCSV()
  .catch((error) => {
    console.error('❌ Fehler beim Seed:', error);
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
