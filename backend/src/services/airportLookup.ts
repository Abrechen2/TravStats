import { prisma } from '../db';

interface ExternalAirportData {
  iata?: string;
  icao?: string;
  name: string;
  city?: string;
  country?: string;
  lat: number;
  lon: number;
  altitude?: number;
}

/**
 * Sucht einen Flughafen in der lokalen DB oder lädt ihn von externen Quellen
 */
export async function findOrCreateAirport(code: string): Promise<any> {
  const upperCode = code.toUpperCase();

  // 1. Zuerst in lokaler DB suchen
  const existingAirport = await prisma.airport.findFirst({
    where: {
      OR: [
        { iata: upperCode },
        { icao: upperCode },
      ],
    },
  });

  if (existingAirport) {
    return existingAirport;
  }

  console.log(`🔍 Flughafen ${code} nicht in DB gefunden, suche extern...`);

  // 2. Von externer API laden
  const externalData = await fetchFromExternalAPI(upperCode);

  if (!externalData) {
    return null;
  }

  // 3. In DB speichern
  console.log(`💾 Speichere neuen Flughafen: ${externalData.name} (${code})`);

  const newAirport = await prisma.airport.create({
    data: {
      iata: externalData.iata || null,
      icao: externalData.icao || null,
      name: externalData.name,
      city: externalData.city || null,
      country: externalData.country || null,
      lat: externalData.lat,
      lon: externalData.lon,
      altitude: externalData.altitude || null,
    },
  });

  return newAirport;
}

/**
 * Lädt Flughafendaten von externen APIs
 * Verwendet mehrere Fallback-Quellen
 */
async function fetchFromExternalAPI(code: string): Promise<ExternalAirportData | null> {
  // Versuche zuerst die kostenlose Airport-Codes API
  try {
    const response = await fetch(
      `https://www.airport-data.com/api/ap_info.json?iata=${code}`
    );

    if (response.ok) {
      const data = await response.json();

      if (data && data.latitude && data.longitude) {
        return {
          iata: data.iata || code,
          icao: data.icao,
          name: data.name,
          city: data.location,
          country: data.country,
          lat: parseFloat(data.latitude),
          lon: parseFloat(data.longitude),
          altitude: data.elevation_ft ? Math.round(parseFloat(data.elevation_ft) * 0.3048) : undefined,
        };
      }
    }
  } catch (error) {
    console.log(`⚠️  Airport-data.com API fehlgeschlagen für ${code}`);
  }

  // Fallback: Versuche OurAirports direkten Lookup
  try {
    const response = await fetch(
      `https://davidmegginson.github.io/ourairports-data/airports.csv`
    );

    if (response.ok) {
      const csvText = await response.text();
      const lines = csvText.split('\n');

      // Finde die Zeile mit dem gesuchten Code
      for (const line of lines) {
        if (line.includes(`,${code},`) || line.includes(`,"${code}",`)) {
          const parts = line.split(',');

          // CSV-Format parsen (vereinfacht)
          // Format: id,ident,type,name,latitude_deg,longitude_deg,...
          const iataCode = parts[13]?.replace(/"/g, '') || null;
          const icaoCode = parts[12]?.replace(/"/g, '') || parts[1]?.replace(/"/g, '');

          if (iataCode === code || icaoCode === code) {
            return {
              iata: iataCode || undefined,
              icao: icaoCode || undefined,
              name: parts[3]?.replace(/"/g, '') || code,
              city: parts[10]?.replace(/"/g, '') || undefined,
              country: parts[8]?.replace(/"/g, '') || undefined,
              lat: parseFloat(parts[4]),
              lon: parseFloat(parts[5]),
              altitude: parts[6] ? Math.round(parseFloat(parts[6]) * 0.3048) : undefined,
            };
          }
        }
      }
    }
  } catch (error) {
    console.log(`⚠️  OurAirports CSV-Lookup fehlgeschlagen für ${code}`);
  }

  console.log(`❌ Kein externer Treffer für ${code} gefunden`);
  return null;
}
