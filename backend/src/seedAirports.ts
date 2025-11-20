import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Extensive list of major airports worldwide
const airports = [
  // Germany
  { iata: 'FRA', icao: 'EDDF', name: 'Frankfurt Airport', city: 'Frankfurt', country: 'Germany', lat: 50.0379, lon: 8.5622, altitude: 364, timezone: 'Europe/Berlin' },
  { iata: 'MUC', icao: 'EDDM', name: 'Munich Airport', city: 'Munich', country: 'Germany', lat: 48.3538, lon: 11.7861, altitude: 1487, timezone: 'Europe/Berlin' },
  { iata: 'BER', icao: 'EDDB', name: 'Berlin Brandenburg', city: 'Berlin', country: 'Germany', lat: 52.3667, lon: 13.5033, altitude: 157, timezone: 'Europe/Berlin' },
  { iata: 'HAM', icao: 'EDDH', name: 'Hamburg Airport', city: 'Hamburg', country: 'Germany', lat: 53.6304, lon: 9.9882, altitude: 53, timezone: 'Europe/Berlin' },
  { iata: 'DUS', icao: 'EDDL', name: 'Düsseldorf Airport', city: 'Düsseldorf', country: 'Germany', lat: 51.2895, lon: 6.7668, altitude: 147, timezone: 'Europe/Berlin' },
  { iata: 'CGN', icao: 'EDDK', name: 'Cologne Bonn Airport', city: 'Cologne', country: 'Germany', lat: 50.8659, lon: 7.1427, altitude: 302, timezone: 'Europe/Berlin' },
  { iata: 'STR', icao: 'EDDS', name: 'Stuttgart Airport', city: 'Stuttgart', country: 'Germany', lat: 48.6899, lon: 9.2220, altitude: 1276, timezone: 'Europe/Berlin' },

  // UK
  { iata: 'LHR', icao: 'EGLL', name: 'London Heathrow', city: 'London', country: 'United Kingdom', lat: 51.4700, lon: -0.4543, altitude: 83, timezone: 'Europe/London' },
  { iata: 'LGW', icao: 'EGKK', name: 'London Gatwick', city: 'London', country: 'United Kingdom', lat: 51.1537, lon: -0.1821, altitude: 202, timezone: 'Europe/London' },
  { iata: 'MAN', icao: 'EGCC', name: 'Manchester Airport', city: 'Manchester', country: 'United Kingdom', lat: 53.3537, lon: -2.2750, altitude: 257, timezone: 'Europe/London' },
  { iata: 'EDI', icao: 'EGPH', name: 'Edinburgh Airport', city: 'Edinburgh', country: 'United Kingdom', lat: 55.9500, lon: -3.3725, altitude: 135, timezone: 'Europe/London' },

  // France
  { iata: 'CDG', icao: 'LFPG', name: 'Charles de Gaulle', city: 'Paris', country: 'France', lat: 49.0097, lon: 2.5479, altitude: 392, timezone: 'Europe/Paris' },
  { iata: 'ORY', icao: 'LFPO', name: 'Paris Orly', city: 'Paris', country: 'France', lat: 48.7233, lon: 2.3794, altitude: 291, timezone: 'Europe/Paris' },
  { iata: 'NCE', icao: 'LFMN', name: 'Nice Côte d\'Azur', city: 'Nice', country: 'France', lat: 43.6584, lon: 7.2159, altitude: 12, timezone: 'Europe/Paris' },

  // Spain
  { iata: 'MAD', icao: 'LEMD', name: 'Adolfo Suárez Madrid-Barajas', city: 'Madrid', country: 'Spain', lat: 40.4983, lon: -3.5676, altitude: 2001, timezone: 'Europe/Madrid' },
  { iata: 'BCN', icao: 'LEBL', name: 'Barcelona El Prat', city: 'Barcelona', country: 'Spain', lat: 41.2971, lon: 2.0785, altitude: 12, timezone: 'Europe/Madrid' },
  { iata: 'PMI', icao: 'LEPA', name: 'Palma de Mallorca', city: 'Palma', country: 'Spain', lat: 39.5517, lon: 2.7388, altitude: 27, timezone: 'Europe/Madrid' },

  // Italy
  { iata: 'FCO', icao: 'LIRF', name: 'Leonardo da Vinci-Fiumicino', city: 'Rome', country: 'Italy', lat: 41.8003, lon: 12.2389, altitude: 13, timezone: 'Europe/Rome' },
  { iata: 'MXP', icao: 'LIMC', name: 'Milan Malpensa', city: 'Milan', country: 'Italy', lat: 45.6306, lon: 8.7281, altitude: 768, timezone: 'Europe/Rome' },
  { iata: 'VCE', icao: 'LIPZ', name: 'Venice Marco Polo', city: 'Venice', country: 'Italy', lat: 45.5053, lon: 12.3519, altitude: 7, timezone: 'Europe/Rome' },

  // Netherlands
  { iata: 'AMS', icao: 'EHAM', name: 'Amsterdam Schiphol', city: 'Amsterdam', country: 'Netherlands', lat: 52.3105, lon: 4.7683, altitude: -11, timezone: 'Europe/Amsterdam' },

  // Switzerland
  { iata: 'ZRH', icao: 'LSZH', name: 'Zurich Airport', city: 'Zurich', country: 'Switzerland', lat: 47.4647, lon: 8.5492, altitude: 1416, timezone: 'Europe/Zurich' },
  { iata: 'GVA', icao: 'LSGG', name: 'Geneva Airport', city: 'Geneva', country: 'Switzerland', lat: 46.2381, lon: 6.1089, altitude: 1411, timezone: 'Europe/Zurich' },

  // Austria
  { iata: 'VIE', icao: 'LOWW', name: 'Vienna International', city: 'Vienna', country: 'Austria', lat: 48.1103, lon: 16.5697, altitude: 600, timezone: 'Europe/Vienna' },

  // Belgium
  { iata: 'BRU', icao: 'EBBR', name: 'Brussels Airport', city: 'Brussels', country: 'Belgium', lat: 50.9014, lon: 4.4844, altitude: 184, timezone: 'Europe/Brussels' },

  // Scandinavia
  { iata: 'CPH', icao: 'EKCH', name: 'Copenhagen Airport', city: 'Copenhagen', country: 'Denmark', lat: 55.6181, lon: 12.6561, altitude: 17, timezone: 'Europe/Copenhagen' },
  { iata: 'ARN', icao: 'ESSA', name: 'Stockholm Arlanda', city: 'Stockholm', country: 'Sweden', lat: 59.6519, lon: 17.9186, altitude: 137, timezone: 'Europe/Stockholm' },
  { iata: 'OSL', icao: 'ENGM', name: 'Oslo Gardermoen', city: 'Oslo', country: 'Norway', lat: 60.1939, lon: 11.1004, altitude: 681, timezone: 'Europe/Oslo' },
  { iata: 'HEL', icao: 'EFHK', name: 'Helsinki-Vantaa', city: 'Helsinki', country: 'Finland', lat: 60.3172, lon: 24.9633, altitude: 179, timezone: 'Europe/Helsinki' },

  // Portugal
  { iata: 'LIS', icao: 'LPPT', name: 'Lisbon Portela', city: 'Lisbon', country: 'Portugal', lat: 38.7742, lon: -9.1342, altitude: 374, timezone: 'Europe/Lisbon' },

  // Eastern Europe
  { iata: 'WAW', icao: 'EPWA', name: 'Warsaw Chopin', city: 'Warsaw', country: 'Poland', lat: 52.1657, lon: 20.9671, altitude: 362, timezone: 'Europe/Warsaw' },
  { iata: 'PRG', icao: 'LKPR', name: 'Prague Václav Havel', city: 'Prague', country: 'Czech Republic', lat: 50.1008, lon: 14.2600, altitude: 1247, timezone: 'Europe/Prague' },
  { iata: 'BUD', icao: 'LHBP', name: 'Budapest Ferenc Liszt', city: 'Budapest', country: 'Hungary', lat: 47.4298, lon: 19.2611, altitude: 495, timezone: 'Europe/Budapest' },

  // Turkey
  { iata: 'IST', icao: 'LTFM', name: 'Istanbul Airport', city: 'Istanbul', country: 'Turkey', lat: 41.2753, lon: 28.7519, altitude: 325, timezone: 'Europe/Istanbul' },

  // Greece
  { iata: 'ATH', icao: 'LGAV', name: 'Athens International', city: 'Athens', country: 'Greece', lat: 37.9364, lon: 23.9445, altitude: 308, timezone: 'Europe/Athens' },

  // USA
  { iata: 'JFK', icao: 'KJFK', name: 'John F. Kennedy International', city: 'New York', country: 'USA', lat: 40.6413, lon: -73.7781, altitude: 13, timezone: 'America/New_York' },
  { iata: 'LAX', icao: 'KLAX', name: 'Los Angeles International', city: 'Los Angeles', country: 'USA', lat: 33.9425, lon: -118.4081, altitude: 38, timezone: 'America/Los_Angeles' },
  { iata: 'ORD', icao: 'KORD', name: 'Chicago O\'Hare International', city: 'Chicago', country: 'USA', lat: 41.9742, lon: -87.9073, altitude: 672, timezone: 'America/Chicago' },
  { iata: 'MIA', icao: 'KMIA', name: 'Miami International', city: 'Miami', country: 'USA', lat: 25.7959, lon: -80.2870, altitude: 11, timezone: 'America/New_York' },
  { iata: 'SFO', icao: 'KSFO', name: 'San Francisco International', city: 'San Francisco', country: 'USA', lat: 37.6213, lon: -122.3790, altitude: 13, timezone: 'America/Los_Angeles' },
  { iata: 'LAS', icao: 'KLAS', name: 'Las Vegas McCarran International', city: 'Las Vegas', country: 'USA', lat: 36.0840, lon: -115.1537, altitude: 2181, timezone: 'America/Los_Angeles' },

  // Canada
  { iata: 'YYZ', icao: 'CYYZ', name: 'Toronto Pearson International', city: 'Toronto', country: 'Canada', lat: 43.6777, lon: -79.6248, altitude: 569, timezone: 'America/Toronto' },
  { iata: 'YVR', icao: 'CYVR', name: 'Vancouver International', city: 'Vancouver', country: 'Canada', lat: 49.1939, lon: -123.1844, altitude: 14, timezone: 'America/Vancouver' },

  // Middle East
  { iata: 'DXB', icao: 'OMDB', name: 'Dubai International', city: 'Dubai', country: 'UAE', lat: 25.2528, lon: 55.3644, altitude: 62, timezone: 'Asia/Dubai' },
  { iata: 'DOH', icao: 'OTHH', name: 'Hamad International', city: 'Doha', country: 'Qatar', lat: 25.2731, lon: 51.6080, altitude: 13, timezone: 'Asia/Qatar' },

  // Asia
  { iata: 'SIN', icao: 'WSSS', name: 'Singapore Changi', city: 'Singapore', country: 'Singapore', lat: 1.3644, lon: 103.9915, altitude: 22, timezone: 'Asia/Singapore' },
  { iata: 'HKG', icao: 'VHHH', name: 'Hong Kong International', city: 'Hong Kong', country: 'Hong Kong', lat: 22.3080, lon: 113.9185, altitude: 28, timezone: 'Asia/Hong_Kong' },
  { iata: 'NRT', icao: 'RJAA', name: 'Tokyo Narita', city: 'Tokyo', country: 'Japan', lat: 35.7720, lon: 140.3929, altitude: 141, timezone: 'Asia/Tokyo' },
  { iata: 'ICN', icao: 'RKSI', name: 'Seoul Incheon', city: 'Seoul', country: 'South Korea', lat: 37.4602, lon: 126.4407, altitude: 23, timezone: 'Asia/Seoul' },
  { iata: 'BKK', icao: 'VTBS', name: 'Bangkok Suvarnabhumi', city: 'Bangkok', country: 'Thailand', lat: 13.6900, lon: 100.7501, altitude: 5, timezone: 'Asia/Bangkok' },

  // Australia
  { iata: 'SYD', icao: 'YSSY', name: 'Sydney Kingsford Smith', city: 'Sydney', country: 'Australia', lat: -33.9461, lon: 151.1772, altitude: 21, timezone: 'Australia/Sydney' },
  { iata: 'MEL', icao: 'YMML', name: 'Melbourne Airport', city: 'Melbourne', country: 'Australia', lat: -37.6733, lon: 144.8433, altitude: 434, timezone: 'Australia/Melbourne' },

  // South America
  { iata: 'GRU', icao: 'SBGR', name: 'São Paulo Guarulhos', city: 'São Paulo', country: 'Brazil', lat: -23.4356, lon: -46.4731, altitude: 2459, timezone: 'America/Sao_Paulo' },
  { iata: 'GIG', icao: 'SBGL', name: 'Rio de Janeiro Galeão', city: 'Rio de Janeiro', country: 'Brazil', lat: -22.8100, lon: -43.2506, altitude: 28, timezone: 'America/Sao_Paulo' },
];

async function seedAirports() {
  console.log('🛫 Seeding airports...');

  for (const airport of airports) {
    await prisma.airport.upsert({
      where: { iata: airport.iata },
      update: airport,
      create: airport,
    });
  }

  console.log(`✅ Seeded ${airports.length} airports`);
  console.log('🎉 Airport seeding completed!');
}

seedAirports()
  .catch((e) => {
    console.error('❌ Airport seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
