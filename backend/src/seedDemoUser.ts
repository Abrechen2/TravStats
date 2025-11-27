import { prisma } from './db';
import { hashPassword } from './utils/password';

// Weltweite Flughäfen für realistische Routen
const airports = [
  // Europa
  { icao: 'EDDM', iata: 'MUC', name: 'Munich Airport', lat: 48.3538, lon: 11.7861, city: 'Munich', country: 'Germany' },
  { icao: 'EDDF', iata: 'FRA', name: 'Frankfurt Airport', lat: 50.0379, lon: 8.5622, city: 'Frankfurt', country: 'Germany' },
  { icao: 'EGLL', iata: 'LHR', name: 'London Heathrow', lat: 51.4700, lon: -0.4543, city: 'London', country: 'UK' },
  { icao: 'LFPG', iata: 'CDG', name: 'Charles de Gaulle', lat: 49.0097, lon: 2.5479, city: 'Paris', country: 'France' },
  { icao: 'EHAM', iata: 'AMS', name: 'Amsterdam Schiphol', lat: 52.3105, lon: 4.7683, city: 'Amsterdam', country: 'Netherlands' },
  { icao: 'LEMD', iata: 'MAD', name: 'Madrid-Barajas', lat: 40.4983, lon: -3.5676, city: 'Madrid', country: 'Spain' },
  { icao: 'LIRF', iata: 'FCO', name: 'Rome Fiumicino', lat: 41.8003, lon: 12.2389, city: 'Rome', country: 'Italy' },
  { icao: 'LOWW', iata: 'VIE', name: 'Vienna International', lat: 48.1103, lon: 16.5697, city: 'Vienna', country: 'Austria' },
  { icao: 'LSZH', iata: 'ZRH', name: 'Zurich Airport', lat: 47.4647, lon: 8.5492, city: 'Zurich', country: 'Switzerland' },
  { icao: 'LEBL', iata: 'BCN', name: 'Barcelona El Prat', lat: 41.2971, lon: 2.0785, city: 'Barcelona', country: 'Spain' },
  { icao: 'LPPT', iata: 'LIS', name: 'Lisbon Airport', lat: 38.7742, lon: -9.1342, city: 'Lisbon', country: 'Portugal' },
  { icao: 'EKCH', iata: 'CPH', name: 'Copenhagen Airport', lat: 55.6181, lon: 12.6561, city: 'Copenhagen', country: 'Denmark' },
  { icao: 'ESSA', iata: 'ARN', name: 'Stockholm Arlanda', lat: 59.6519, lon: 17.9186, city: 'Stockholm', country: 'Sweden' },
  { icao: 'ENGM', iata: 'OSL', name: 'Oslo Gardermoen', lat: 60.1939, lon: 11.1004, city: 'Oslo', country: 'Norway' },
  { icao: 'LKPR', iata: 'PRG', name: 'Prague Airport', lat: 50.1008, lon: 14.2600, city: 'Prague', country: 'Czech Republic' },
  { icao: 'EPWA', iata: 'WAW', name: 'Warsaw Chopin', lat: 52.1657, lon: 20.9671, city: 'Warsaw', country: 'Poland' },
  { icao: 'LHBP', iata: 'BUD', name: 'Budapest Airport', lat: 47.4397, lon: 19.2556, city: 'Budapest', country: 'Hungary' },
  { icao: 'LATI', iata: 'TIA', name: 'Tirana Airport', lat: 41.4147, lon: 19.7206, city: 'Tirana', country: 'Albania' },
  { icao: 'LTFM', iata: 'IST', name: 'Istanbul Airport', lat: 41.2753, lon: 28.7519, city: 'Istanbul', country: 'Turkey' },
  { icao: 'LGAV', iata: 'ATH', name: 'Athens Airport', lat: 37.9364, lon: 23.9445, city: 'Athens', country: 'Greece' },

  // Nordamerika
  { icao: 'KJFK', iata: 'JFK', name: 'John F. Kennedy Intl', lat: 40.6413, lon: -73.7781, city: 'New York', country: 'USA' },
  { icao: 'KLAX', iata: 'LAX', name: 'Los Angeles Intl', lat: 33.9416, lon: -118.4085, city: 'Los Angeles', country: 'USA' },
  { icao: 'KORD', iata: 'ORD', name: "O'Hare International", lat: 41.9742, lon: -87.9073, city: 'Chicago', country: 'USA' },
  { icao: 'KSFO', iata: 'SFO', name: 'San Francisco Intl', lat: 37.6213, lon: -122.3790, city: 'San Francisco', country: 'USA' },
  { icao: 'KMIA', iata: 'MIA', name: 'Miami International', lat: 25.7959, lon: -80.2870, city: 'Miami', country: 'USA' },
  { icao: 'CYYZ', iata: 'YYZ', name: 'Toronto Pearson', lat: 43.6777, lon: -79.6248, city: 'Toronto', country: 'Canada' },
  { icao: 'CYVR', iata: 'YVR', name: 'Vancouver Intl', lat: 49.1939, lon: -123.1844, city: 'Vancouver', country: 'Canada' },
  { icao: 'MMMX', iata: 'MEX', name: 'Mexico City Intl', lat: 19.4363, lon: -99.0721, city: 'Mexico City', country: 'Mexico' },

  // Asien
  { icao: 'RJTT', iata: 'HND', name: 'Tokyo Haneda', lat: 35.5494, lon: 139.7798, city: 'Tokyo', country: 'Japan' },
  { icao: 'RJBB', iata: 'KIX', name: 'Kansai International', lat: 34.4273, lon: 135.2440, city: 'Osaka', country: 'Japan' },
  { icao: 'VHHH', iata: 'HKG', name: 'Hong Kong Intl', lat: 22.3080, lon: 113.9185, city: 'Hong Kong', country: 'China' },
  { icao: 'WSSS', iata: 'SIN', name: 'Singapore Changi', lat: 1.3644, lon: 103.9915, city: 'Singapore', country: 'Singapore' },
  { icao: 'RKSI', iata: 'ICN', name: 'Seoul Incheon', lat: 37.4602, lon: 126.4407, city: 'Seoul', country: 'South Korea' },
  { icao: 'VTBS', iata: 'BKK', name: 'Bangkok Suvarnabhumi', lat: 13.6900, lon: 100.7501, city: 'Bangkok', country: 'Thailand' },
  { icao: 'VIDP', iata: 'DEL', name: 'Indira Gandhi Intl', lat: 28.5562, lon: 77.1000, city: 'New Delhi', country: 'India' },
  { icao: 'OMDB', iata: 'DXB', name: 'Dubai International', lat: 25.2532, lon: 55.3657, city: 'Dubai', country: 'UAE' },
  { icao: 'OTHH', iata: 'DOH', name: 'Hamad International', lat: 25.2731, lon: 51.6080, city: 'Doha', country: 'Qatar' },
  { icao: 'ZBAA', iata: 'PEK', name: 'Beijing Capital', lat: 40.0799, lon: 116.6031, city: 'Beijing', country: 'China' },
  { icao: 'ZSSS', iata: 'SHA', name: 'Shanghai Hongqiao', lat: 31.1979, lon: 121.3364, city: 'Shanghai', country: 'China' },

  // Ozeanien
  { icao: 'YSSY', iata: 'SYD', name: 'Sydney Kingsford Smith', lat: -33.9399, lon: 151.1753, city: 'Sydney', country: 'Australia' },
  { icao: 'YMML', iata: 'MEL', name: 'Melbourne Airport', lat: -37.6690, lon: 144.8410, city: 'Melbourne', country: 'Australia' },
  { icao: 'NZAA', iata: 'AKL', name: 'Auckland Airport', lat: -37.0082, lon: 174.7850, city: 'Auckland', country: 'New Zealand' },

  // Südamerika
  { icao: 'SBGR', iata: 'GRU', name: 'São Paulo-Guarulhos', lat: -23.4356, lon: -46.4731, city: 'São Paulo', country: 'Brazil' },
  { icao: 'SAEZ', iata: 'EZE', name: 'Buenos Aires Ezeiza', lat: -34.8222, lon: -58.5358, city: 'Buenos Aires', country: 'Argentina' },
  { icao: 'SCEL', iata: 'SCL', name: 'Santiago Intl', lat: -33.3930, lon: -70.7858, city: 'Santiago', country: 'Chile' },

  // Afrika
  { icao: 'FACT', iata: 'CPT', name: 'Cape Town Intl', lat: -33.9715, lon: 18.6021, city: 'Cape Town', country: 'South Africa' },
  { icao: 'HECA', iata: 'CAI', name: 'Cairo International', lat: 30.1219, lon: 31.4056, city: 'Cairo', country: 'Egypt' },
  { icao: 'GMMN', iata: 'RAK', name: 'Marrakech Menara', lat: 31.6069, lon: -8.0363, city: 'Marrakech', country: 'Morocco' },
];

const airlines = [
  { name: 'Lufthansa', prefix: 'LH', aircraft: ['A320neo', 'A321neo', 'A350-900', 'B747-8', 'A380'] },
  { name: 'British Airways', prefix: 'BA', aircraft: ['A320', 'A321neo', 'B787-9', 'A380'] },
  { name: 'Air France', prefix: 'AF', aircraft: ['A220-300', 'A320neo', 'B777-300ER', 'A350-900'] },
  { name: 'Emirates', prefix: 'EK', aircraft: ['A380', 'B777-300ER'] },
  { name: 'Singapore Airlines', prefix: 'SQ', aircraft: ['A380', 'A350-900', 'B787-10'] },
  { name: 'Qantas', prefix: 'QF', aircraft: ['A380', 'B787-9', 'A330-300'] },
  { name: 'United Airlines', prefix: 'UA', aircraft: ['B737-900ER', 'B787-9', 'B777-300ER'] },
  { name: 'American Airlines', prefix: 'AA', aircraft: ['B737 MAX 8', 'B787-9', 'A321neo'] },
  { name: 'Turkish Airlines', prefix: 'TK', aircraft: ['A321neo', 'B787-9', 'A350-900'] },
  { name: 'Swiss', prefix: 'LX', aircraft: ['A220-300', 'A320neo', 'A330-300'] },
];

const classes = ['economy', 'premium_economy', 'business', 'first'];
const categories = ['vacation', 'business', 'private'];

// Realistische Flüge: München als Hauptflughafen
const flightRoutes = [
  // Europa (Kurzstrecke) - häufig
  { dep: 'MUC', arr: 'LHR', airline: 'Lufthansa', flightNum: '2470', duration: 2 },
  { dep: 'MUC', arr: 'CDG', airline: 'Lufthansa', flightNum: '2230', duration: 1.5 },
  { dep: 'MUC', arr: 'AMS', airline: 'Lufthansa', flightNum: '1000', duration: 1.3 },
  { dep: 'MUC', arr: 'VIE', airline: 'Lufthansa', flightNum: '2280', duration: 0.8 },
  { dep: 'MUC', arr: 'ZRH', airline: 'Swiss', flightNum: '2804', duration: 0.7 },
  { dep: 'MUC', arr: 'FCO', airline: 'Lufthansa', flightNum: '1852', duration: 1.3 },
  { dep: 'MUC', arr: 'BCN', airline: 'Lufthansa', flightNum: '1810', duration: 2 },
  { dep: 'MUC', arr: 'MAD', airline: 'Lufthansa', flightNum: '1516', duration: 2.5 },
  { dep: 'MUC', arr: 'LIS', airline: 'Lufthansa', flightNum: '1756', duration: 3 },
  { dep: 'MUC', arr: 'CPH', airline: 'Lufthansa', flightNum: '2462', duration: 1.5 },
  { dep: 'MUC', arr: 'ARN', airline: 'Lufthansa', flightNum: '2418', duration: 2 },
  { dep: 'MUC', arr: 'OSL', airline: 'Lufthansa', flightNum: '2446', duration: 2 },
  { dep: 'MUC', arr: 'PRG', airline: 'Lufthansa', flightNum: '1394', duration: 0.8 },
  { dep: 'MUC', arr: 'WAW', airline: 'Lufthansa', flightNum: '1348', duration: 1.5 },
  { dep: 'MUC', arr: 'BUD', airline: 'Lufthansa', flightNum: '1678', duration: 1.2 },
  { dep: 'MUC', arr: 'IST', airline: 'Turkish Airlines', flightNum: '1630', duration: 3 },
  { dep: 'MUC', arr: 'ATH', airline: 'Lufthansa', flightNum: '1752', duration: 2.5 },

  // Langstrecke über Hubs (Multi-Stopp)
  { dep: 'MUC', arr: 'FRA', airline: 'Lufthansa', flightNum: '110', duration: 1 },
  { dep: 'FRA', arr: 'JFK', airline: 'Lufthansa', flightNum: '400', duration: 9 },
  { dep: 'MUC', arr: 'FRA', airline: 'Lufthansa', flightNum: '112', duration: 1 },
  { dep: 'FRA', arr: 'LAX', airline: 'Lufthansa', flightNum: '452', duration: 11.5 },
  { dep: 'MUC', arr: 'FRA', airline: 'Lufthansa', flightNum: '114', duration: 1 },
  { dep: 'FRA', arr: 'SFO', airline: 'Lufthansa', flightNum: '454', duration: 11 },

  // Direkt Langstrecke
  { dep: 'MUC', arr: 'JFK', airline: 'Lufthansa', flightNum: '410', duration: 9.5 },
  { dep: 'MUC', arr: 'ORD', airline: 'Lufthansa', flightNum: '434', duration: 9.5 },
  { dep: 'MUC', arr: 'YYZ', airline: 'Lufthansa', flightNum: '474', duration: 9 },
  { dep: 'MUC', arr: 'DXB', airline: 'Emirates', flightNum: '050', duration: 6 },
  { dep: 'MUC', arr: 'SIN', airline: 'Singapore Airlines', flightNum: '328', duration: 12 },
  { dep: 'MUC', arr: 'BKK', airline: 'Lufthansa', flightNum: '772', duration: 10.5 },
  { dep: 'MUC', arr: 'HKG', airline: 'Lufthansa', flightNum: '796', duration: 11 },
  { dep: 'MUC', arr: 'HND', airline: 'Lufthansa', flightNum: '714', duration: 11.5 },

  // Rückflüge
  { dep: 'JFK', arr: 'MUC', airline: 'Lufthansa', flightNum: '411', duration: 8 },
  { dep: 'LAX', arr: 'FRA', airline: 'Lufthansa', flightNum: '453', duration: 10.5 },
  { dep: 'FRA', arr: 'MUC', airline: 'Lufthansa', flightNum: '115', duration: 1 },
  { dep: 'SIN', arr: 'MUC', airline: 'Singapore Airlines', flightNum: '327', duration: 13 },
  { dep: 'DXB', arr: 'MUC', airline: 'Emirates', flightNum: '051', duration: 6 },
  { dep: 'SYD', arr: 'DXB', airline: 'Emirates', flightNum: '412', duration: 14 },
  { dep: 'DXB', arr: 'MUC', airline: 'Emirates', flightNum: '053', duration: 6 },
];

async function seedDemoUser() {
  console.log('🔐 Creating demo user with sample flights...');

  try {
    // Check if demo user already exists
    const existingUser = await prisma.user.findUnique({
      where: { username: 'demo' },
    });

    if (existingUser) {
      console.log('   Demo user already exists (skipping)');
      return;
    }

    // Create demo user
    const passwordHash = await hashPassword('demo123');
    const demoUser = await prisma.user.create({
      data: {
        username: 'demo',
        passwordHash,
      },
    });

    console.log('✅ Demo user created');
    console.log('   Username: demo');
    console.log('   Password: demo123');
    console.log('');
    console.log('✈️  Creating 120 sample flights...');

    // Generate 120 flights over 4 years (2020-2024)
    const flights = [];
    const startDate = new Date('2020-01-01');
    const endDate = new Date('2024-12-31');

    for (let i = 0; i < 120; i++) {
      const route = flightRoutes[i % flightRoutes.length];
      const airline = airlines.find(a => a.name === route.airline) || airlines[0];

      // Random date between start and end
      const randomTime = startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime());
      const departureTime = new Date(randomTime);
      departureTime.setHours(Math.floor(Math.random() * 20) + 4); // 4-24 Uhr
      departureTime.setMinutes(Math.floor(Math.random() * 60));

      const arrivalTime = new Date(departureTime);
      arrivalTime.setHours(arrivalTime.getHours() + Math.floor(route.duration));
      arrivalTime.setMinutes(arrivalTime.getMinutes() + Math.floor((route.duration % 1) * 60));

      const depAirport = airports.find(a => a.iata === route.dep)!;
      const arrAirport = airports.find(a => a.iata === route.arr)!;

      const seatClass = classes[Math.floor(Math.random() * classes.length)];
      const category = categories[Math.floor(Math.random() * categories.length)];
      const aircraft = airline.aircraft[Math.floor(Math.random() * airline.aircraft.length)];

      flights.push({
        userId: demoUser.id,
        airline: airline.name,
        flightNumber: airline.prefix + route.flightNum,
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
        status: 'flown',
        seatClass,
        category,
        seatNumber: `${Math.floor(Math.random() * 40) + 1}${String.fromCharCode(65 + Math.floor(Math.random() * 6))}`,
        gate: `${String.fromCharCode(65 + Math.floor(Math.random() * 10))}${Math.floor(Math.random() * 30) + 1}`,
        terminal: Math.floor(Math.random() * 3) + 1 + '',
      });
    }

    // Sort by date
    flights.sort((a, b) => a.departureTime.getTime() - b.departureTime.getTime());

    // Insert flights in batches
    const batchSize = 20;
    for (let i = 0; i < flights.length; i += batchSize) {
      const batch = flights.slice(i, i + batchSize);
      await prisma.flight.createMany({
        data: batch,
      });
      console.log(`   Created flights ${i + 1}-${Math.min(i + batchSize, flights.length)} of ${flights.length}`);
    }

    console.log('');
    console.log('✅ Demo user setup complete!');
    console.log(`   Created ${flights.length} flights from 2020-2024`);
    console.log('   Main hub: Munich (MUC)');
    console.log('   Routes: Europe, Americas, Asia, Oceania, Africa');
  } catch (error) {
    console.error('❌ Failed to create demo user:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedDemoUser();
