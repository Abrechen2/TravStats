/**
 * OpenFlights Airport Database Import Script
 *
 * Downloads and imports ~14,000 airports from OpenFlights.org
 * Run with: npx ts-node src/scripts/importAirports.ts
 */

import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface OpenFlightsAirport {
  airportId: string;
  name: string;
  city: string;
  country: string;
  iata: string;
  icao: string;
  latitude: number;
  longitude: number;
  altitude: number;
  timezone: string;
  dst: string;
  tzDatabaseTimezone: string;
  type: string;
  source: string;
}

// OpenFlights airport database URL (CSV format)
const OPENFLIGHTS_URL = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';

/**
 * Parse OpenFlights CSV line
 * Format: AirportID,Name,City,Country,IATA,ICAO,Latitude,Longitude,Altitude,Timezone,DST,Tz database time zone,Type,Source
 */
function parseAirportLine(line: string): OpenFlightsAirport | null {
  try {
    // Split CSV (handling quoted fields with commas)
    const regex = /("(?:[^"\\]|\\.)*"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g;
    const fields = line.match(regex)?.map(field =>
      field.replace(/^"|"$/g, '').replace(/\\"/g, '"')
    ) || [];

    if (fields.length < 14) return null;

    const [
      airportId, name, city, country, iata, icao,
      latitude, longitude, altitude, timezone, dst, tzDatabaseTimezone,
      type, source
    ] = fields;

    return {
      airportId,
      name,
      city,
      country,
      iata: iata === '\\N' ? '' : iata,
      icao: icao === '\\N' ? '' : icao,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      altitude: altitude === '\\N' ? 0 : parseInt(altitude),
      timezone,
      dst,
      tzDatabaseTimezone,
      type,
      source,
    };
  } catch (error) {
    console.error('Error parsing line:', line, error);
    return null;
  }
}

/**
 * Download and import OpenFlights airport database
 */
async function importAirports() {
  console.log('🌍 Downloading OpenFlights airport database...');

  try {
    const response = await axios.get(OPENFLIGHTS_URL);
    const lines = response.data.split('\n').filter((line: string) => line.trim());

    console.log(`📦 Found ${lines.length} airports to process`);

    let imported = 0;
    let skipped = 0;
    let updated = 0;

    for (const line of lines) {
      const airport = parseAirportLine(line);

      if (!airport) {
        skipped++;
        continue;
      }

      // Skip airports without IATA or ICAO (usually military or closed)
      if (!airport.iata && !airport.icao) {
        skipped++;
        continue;
      }

      try {
        // Upsert airport (update if exists, create if not)
        await prisma.airport.upsert({
          where: airport.iata
            ? { iata: airport.iata }
            : airport.icao
            ? { icao: airport.icao }
            : { id: -1 }, // Fallback (will create new)
          update: {
            name: airport.name,
            city: airport.city || null,
            country: airport.country || null,
            icao: airport.icao || null,
            lat: airport.latitude,
            lon: airport.longitude,
            altitude: airport.altitude,
            timezone: airport.tzDatabaseTimezone || null,
          },
          create: {
            iata: airport.iata || null,
            icao: airport.icao || null,
            name: airport.name,
            city: airport.city || null,
            country: airport.country || null,
            lat: airport.latitude,
            lon: airport.longitude,
            altitude: airport.altitude,
            timezone: airport.tzDatabaseTimezone || null,
          },
        });

        imported++;

        if (imported % 100 === 0) {
          console.log(`   ✅ Imported ${imported} airports...`);
        }
      } catch (error: any) {
        // Handle duplicate key errors gracefully
        if (error.code === 'P2002') {
          updated++;
        } else {
          console.error(`   ❌ Error importing ${airport.name}:`, error.message);
        }
      }
    }

    console.log('\n✅ Import completed!');
    console.log(`   Imported: ${imported} airports`);
    console.log(`   Updated: ${updated} airports`);
    console.log(`   Skipped: ${skipped} airports`);

  } catch (error: any) {
    console.error('❌ Error downloading or importing airports:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run import if executed directly
if (require.main === module) {
  importAirports()
    .then(() => {
      console.log('\n🎉 Airport database is ready!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { importAirports };
