import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Weltweite Flughäfen
const worldAirports = [
  // Europa
  { icao: 'EDDF', iata: 'FRA', name: 'Frankfurt Airport', lat: 50.0379, lon: 8.5622, city: 'Frankfurt', country: 'Germany' },
  { icao: 'EGLL', iata: 'LHR', name: 'London Heathrow', lat: 51.4700, lon: -0.4543, city: 'London', country: 'United Kingdom' },
  { icao: 'LFPG', iata: 'CDG', name: 'Charles de Gaulle', lat: 49.0097, lon: 2.5479, city: 'Paris', country: 'France' },
  { icao: 'EHAM', iata: 'AMS', name: 'Amsterdam Schiphol', lat: 52.3105, lon: 4.7683, city: 'Amsterdam', country: 'Netherlands' },
  { icao: 'LEMD', iata: 'MAD', name: 'Madrid-Barajas', lat: 40.4983, lon: -3.5676, city: 'Madrid', country: 'Spain' },
  { icao: 'LIRF', iata: 'FCO', name: 'Rome Fiumicino', lat: 41.8003, lon: 12.2389, city: 'Rome', country: 'Italy' },
  { icao: 'LOWW', iata: 'VIE', name: 'Vienna International', lat: 48.1103, lon: 16.5697, city: 'Vienna', country: 'Austria' },
  { icao: 'LSZH', iata: 'ZRH', name: 'Zurich Airport', lat: 47.4647, lon: 8.5492, city: 'Zurich', country: 'Switzerland' },
  { icao: 'EDDM', iata: 'MUC', name: 'Munich Airport', lat: 48.3538, lon: 11.7861, city: 'Munich', country: 'Germany' },
  { icao: 'EDDB', iata: 'BER', name: 'Berlin Brandenburg', lat: 52.3667, lon: 13.5033, city: 'Berlin', country: 'Germany' },
  { icao: 'LPPT', iata: 'LIS', name: 'Lisbon Airport', lat: 38.7742, lon: -9.1342, city: 'Lisbon', country: 'Portugal' },
  { icao: 'EKCH', iata: 'CPH', name: 'Copenhagen Airport', lat: 55.6181, lon: 12.6561, city: 'Copenhagen', country: 'Denmark' },
  { icao: 'ESSA', iata: 'ARN', name: 'Stockholm Arlanda', lat: 59.6519, lon: 17.9186, city: 'Stockholm', country: 'Sweden' },
  { icao: 'LEBL', iata: 'BCN', name: 'Barcelona El Prat', lat: 41.2971, lon: 2.0785, city: 'Barcelona', country: 'Spain' },
  { icao: 'LFPO', iata: 'ORY', name: 'Paris Orly', lat: 48.7233, lon: 2.3794, city: 'Paris', country: 'France' },

  // Nordamerika
  { icao: 'KJFK', iata: 'JFK', name: 'John F. Kennedy International', lat: 40.6413, lon: -73.7781, city: 'New York', country: 'USA' },
  { icao: 'KLAX', iata: 'LAX', name: 'Los Angeles International', lat: 33.9416, lon: -118.4085, city: 'Los Angeles', country: 'USA' },
  { icao: 'KORD', iata: 'ORD', name: "O'Hare International", lat: 41.9742, lon: -87.9073, city: 'Chicago', country: 'USA' },
  { icao: 'KSFO', iata: 'SFO', name: 'San Francisco International', lat: 37.6213, lon: -122.3790, city: 'San Francisco', country: 'USA' },
  { icao: 'KMIA', iata: 'MIA', name: 'Miami International', lat: 25.7959, lon: -80.2870, city: 'Miami', country: 'USA' },
  { icao: 'CYYZ', iata: 'YYZ', name: 'Toronto Pearson', lat: 43.6777, lon: -79.6248, city: 'Toronto', country: 'Canada' },
  { icao: 'CYVR', iata: 'YVR', name: 'Vancouver International', lat: 49.1939, lon: -123.1844, city: 'Vancouver', country: 'Canada' },
  { icao: 'MMMX', iata: 'MEX', name: 'Mexico City International', lat: 19.4363, lon: -99.0721, city: 'Mexico City', country: 'Mexico' },

  // Asien
  { icao: 'RJTT', iata: 'HND', name: 'Tokyo Haneda', lat: 35.5494, lon: 139.7798, city: 'Tokyo', country: 'Japan' },
  { icao: 'RJBB', iata: 'KIX', name: 'Kansai International', lat: 34.4273, lon: 135.2440, city: 'Osaka', country: 'Japan' },
  { icao: 'VHHH', iata: 'HKG', name: 'Hong Kong International', lat: 22.3080, lon: 113.9185, city: 'Hong Kong', country: 'China' },
  { icao: 'WSSS', iata: 'SIN', name: 'Singapore Changi', lat: 1.3644, lon: 103.9915, city: 'Singapore', country: 'Singapore' },
  { icao: 'RKSI', iata: 'ICN', name: 'Seoul Incheon', lat: 37.4602, lon: 126.4407, city: 'Seoul', country: 'South Korea' },
  { icao: 'VTBS', iata: 'BKK', name: 'Bangkok Suvarnabhumi', lat: 13.6900, lon: 100.7501, city: 'Bangkok', country: 'Thailand' },
  { icao: 'VIDP', iata: 'DEL', name: 'Indira Gandhi International', lat: 28.5562, lon: 77.1000, city: 'New Delhi', country: 'India' },
  { icao: 'OMDB', iata: 'DXB', name: 'Dubai International', lat: 25.2532, lon: 55.3657, city: 'Dubai', country: 'UAE' },
  { icao: 'OTHH', iata: 'DOH', name: 'Hamad International', lat: 25.2731, lon: 51.6080, city: 'Doha', country: 'Qatar' },

  // Ozeanien
  { icao: 'YSSY', iata: 'SYD', name: 'Sydney Kingsford Smith', lat: -33.9399, lon: 151.1753, city: 'Sydney', country: 'Australia' },
  { icao: 'YMML', iata: 'MEL', name: 'Melbourne Airport', lat: -37.6690, lon: 144.8410, city: 'Melbourne', country: 'Australia' },
  { icao: 'NZAA', iata: 'AKL', name: 'Auckland Airport', lat: -37.0082, lon: 174.7850, city: 'Auckland', country: 'New Zealand' },

  // Südamerika
  { icao: 'SBGR', iata: 'GRU', name: 'São Paulo-Guarulhos', lat: -23.4356, lon: -46.4731, city: 'São Paulo', country: 'Brazil' },
  { icao: 'SAEZ', iata: 'EZE', name: 'Buenos Aires Ezeiza', lat: -34.8222, lon: -58.5358, city: 'Buenos Aires', country: 'Argentina' },
  { icao: 'SCEL', iata: 'SCL', name: 'Santiago International', lat: -33.3930, lon: -70.7858, city: 'Santiago', country: 'Chile' },

  // Afrika
  { icao: 'FACT', iata: 'CPT', name: 'Cape Town International', lat: -33.9715, lon: 18.6021, city: 'Cape Town', country: 'South Africa' },
  { icao: 'HECA', iata: 'CAI', name: 'Cairo International', lat: 30.1219, lon: 31.4056, city: 'Cairo', country: 'Egypt' },
];

// Realistische Airlines mit ihren Flugzeugtypen
const airlines = [
  {
    name: 'Lufthansa',
    prefix: 'LH',
    aircraft: ['A320neo', 'A321neo', 'A350-900', 'B747-8', 'A380'],
    hubs: ['FRA', 'MUC']
  },
  {
    name: 'British Airways',
    prefix: 'BA',
    aircraft: ['A320', 'A321neo', 'B787-9', 'B777-300ER', 'A380'],
    hubs: ['LHR']
  },
  {
    name: 'Air France',
    prefix: 'AF',
    aircraft: ['A220-300', 'A320neo', 'B777-300ER', 'A350-900', 'B787-9'],
    hubs: ['CDG', 'ORY']
  },
  {
    name: 'KLM',
    prefix: 'KL',
    aircraft: ['B737-800', 'B737-900', 'B787-9', 'B777-300ER', 'A330-300'],
    hubs: ['AMS']
  },
  {
    name: 'Swiss',
    prefix: 'LX',
    aircraft: ['A220-100', 'A220-300', 'A320neo', 'A330-300', 'B777-300ER'],
    hubs: ['ZRH']
  },
  {
    name: 'Emirates',
    prefix: 'EK',
    aircraft: ['A380', 'B777-300ER', 'B777-200LR'],
    hubs: ['DXB']
  },
  {
    name: 'Singapore Airlines',
    prefix: 'SQ',
    aircraft: ['A350-900', 'A380', 'B787-10', 'B777-300ER'],
    hubs: ['SIN']
  },
  {
    name: 'Qatar Airways',
    prefix: 'QR',
    aircraft: ['A350-900', 'A350-1000', 'B787-8', 'B777-300ER', 'A380'],
    hubs: ['DOH']
  },
  {
    name: 'United Airlines',
    prefix: 'UA',
    aircraft: ['B737-900ER', 'B787-9', 'B777-300ER', 'A320'],
    hubs: ['ORD', 'SFO', 'LAX']
  },
  {
    name: 'American Airlines',
    prefix: 'AA',
    aircraft: ['B737-800', 'A321neo', 'B787-9', 'B777-300ER'],
    hubs: ['JFK', 'LAX', 'MIA']
  },
  {
    name: 'ANA',
    prefix: 'NH',
    aircraft: ['B787-9', 'B777-300ER', 'A380', 'B737-800'],
    hubs: ['HND']
  },
  {
    name: 'Cathay Pacific',
    prefix: 'CX',
    aircraft: ['A350-900', 'A350-1000', 'B777-300ER', 'A330-300'],
    hubs: ['HKG']
  },
];

const boardingGroups = ['1', '2', '3', '4', '5', 'A', 'B', 'C', 'D'];
const gates = ['A1', 'A2', 'A3', 'B4', 'B5', 'C1', 'C2', 'D1', 'E5', 'F3', 'G7', 'H2'];
const terminals = ['1', '2', '3', 'A', 'B', 'C'];
const statuses = ['flown', 'flown', 'flown', 'flown', 'flown', 'scheduled', 'cancelled'];

// Hilfsfunktion für zufällige Auswahl
function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Hilfsfunktion für zufällige Sitzplatznummer
function generateSeatNumber(seatClass: string): string {
  const rows = {
    first: [1, 2, 3, 4, 5],
    business: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    premium_economy: [16, 17, 18, 19, 20],
    economy: Array.from({length: 25}, (_, i) => i + 21)
  };

  const row = randomChoice(rows[seatClass as keyof typeof rows]);
  const seat = randomChoice(['A', 'B', 'C', 'D', 'E', 'F']);
  return `${row}${seat}`;
}

// Hilfsfunktion für Booking Reference
function generateBookingRef(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Hilfsfunktion für Ticket Number
function generateTicketNumber(_airlinePrefix: string): string {
  const airlineCode = String(Math.floor(Math.random() * 900) + 100);
  const ticketNum = String(Math.floor(Math.random() * 9000000000) + 1000000000);
  return `${airlineCode}-${ticketNum}`;
}

async function main() {
  console.log('🌱 Seeding enhanced flight database...');

  // Finde oder erstelle Demo User
  const users = await prisma.user.findMany({ where: { username: 'demo' } });

  if (users.length === 0) {
    console.log('❌ Demo user not found. Please run seed.ts first.');
    return;
  }

  const user = users[0];
  console.log(`✅ Found user: ${user.username}`);

  // Lösche alte Flüge des Demo Users
  await prisma.flight.deleteMany({ where: { userId: user.id } });
  console.log('🗑️  Deleted old flights');

  const flights = [];

  // Generiere 120 realistische Flüge über 5 Jahre (2020-2025)
  const totalFlights = 120;

  for (let i = 0; i < totalFlights; i++) {
    // Wähle zufällige Airline
    const airline = randomChoice(airlines);

    // Wähle Start- und Zielflughafen (oft von/nach Hub)
    const useHub = Math.random() > 0.5;
    let depAirport: typeof worldAirports[0];
    let arrAirport: typeof worldAirports[0];

    if (useHub && airline.hubs.length > 0) {
      const hubCode = randomChoice(airline.hubs);
      const hubAirport = worldAirports.find(a => a.iata === hubCode);

      if (hubAirport) {
        // 50% von Hub, 50% zu Hub
        if (Math.random() > 0.5) {
          depAirport = hubAirport;
          arrAirport = randomChoice(worldAirports.filter(a => a.iata !== hubCode));
        } else {
          arrAirport = hubAirport;
          depAirport = randomChoice(worldAirports.filter(a => a.iata !== hubCode));
        }
      } else {
        depAirport = randomChoice(worldAirports);
        arrAirport = randomChoice(worldAirports.filter(a => a.iata !== depAirport.iata));
      }
    } else {
      depAirport = randomChoice(worldAirports);
      arrAirport = randomChoice(worldAirports.filter(a => a.iata !== depAirport.iata));
    }

    // Berechne ungefähre Flugdistanz für realistische Flugzeit
    const distance = Math.sqrt(
      Math.pow(arrAirport.lat - depAirport.lat, 2) +
      Math.pow(arrAirport.lon - depAirport.lon, 2)
    ) * 111; // Grobe km-Konversion

    const durationHours = Math.max(1, Math.min(16, distance / 800)); // ca. 800 km/h

    // Zufälliges Datum zwischen 2020 und 2025
    const year = 2020 + Math.floor(Math.random() * 6);
    const month = Math.floor(Math.random() * 12);
    const day = Math.floor(Math.random() * 28) + 1;
    const hour = Math.floor(Math.random() * 24);
    const minute = Math.floor(Math.random() * 60);

    const departureTime = new Date(year, month, day, hour, minute);
    const arrivalTime = new Date(departureTime.getTime() + durationHours * 60 * 60 * 1000);

    // Sitzklasse (70% Economy, 20% Business, 8% Premium Economy, 2% First)
    let seatClass: string;
    const rand = Math.random();
    if (rand < 0.70) seatClass = 'economy';
    else if (rand < 0.90) seatClass = 'business';
    else if (rand < 0.98) seatClass = 'premium_economy';
    else seatClass = 'first';

    const aircraft = randomChoice(airline.aircraft);
    const flightNum = Math.floor(Math.random() * 9000) + 100;
    const status = randomChoice(statuses);

    flights.push({
      userId: user.id,
      airline: airline.name,
      flightNumber: `${airline.prefix}${flightNum}`,
      callsign: `${airline.prefix}${flightNum}`,
      aircraft,
      depIcao: depAirport.icao,
      depIata: depAirport.iata,
      depName: depAirport.name,
      depLat: depAirport.lat,
      depLon: depAirport.lon,
      arrIcao: arrAirport.icao,
      arrIata: arrAirport.iata,
      arrName: arrAirport.name,
      arrLat: arrAirport.lat,
      arrLon: arrAirport.lon,
      departureTime,
      arrivalTime,
      status,
      // Neue Felder
      seatClass,
      seatNumber: generateSeatNumber(seatClass),
      boardingGroup: randomChoice(boardingGroups),
      gate: randomChoice(gates),
      terminal: randomChoice(terminals),
      bookingReference: generateBookingRef(),
      ticketNumber: generateTicketNumber(airline.prefix),
      notes: Math.random() > 0.8 ? `${seatClass === 'business' || seatClass === 'first' ? 'Excellent service!' : 'Good flight'} on ${aircraft}` : null,
    });
  }

  // Sortiere Flüge nach Datum
  flights.sort((a, b) => a.departureTime.getTime() - b.departureTime.getTime());

  // Füge Flüge zur Datenbank hinzu
  await prisma.flight.createMany({
    data: flights,
  });

  console.log(`✅ Created ${flights.length} enhanced flights`);
  console.log(`   - Years covered: 2020-2025`);
  console.log(`   - Airports: ${worldAirports.length} worldwide`);
  console.log(`   - Airlines: ${airlines.length}`);
  console.log(`   - Seat classes: Economy, Premium Economy, Business, First`);
  console.log('🎉 Enhanced seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
