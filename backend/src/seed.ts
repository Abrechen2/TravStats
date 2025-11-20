import { PrismaClient } from '@prisma/client';
import { hashPassword } from './utils/password';

const prisma = new PrismaClient();

const airports = [
  { icao: 'EDDF', iata: 'FRA', name: 'Frankfurt Airport', lat: 50.0379, lon: 8.5622 },
  { icao: 'EGLL', iata: 'LHR', name: 'London Heathrow', lat: 51.4700, lon: -0.4543 },
  { icao: 'KJFK', iata: 'JFK', name: 'John F. Kennedy International', lat: 40.6413, lon: -73.7781 },
  { icao: 'LFPG', iata: 'CDG', name: 'Charles de Gaulle', lat: 49.0097, lon: 2.5479 },
  { icao: 'EHAM', iata: 'AMS', name: 'Amsterdam Schiphol', lat: 52.3105, lon: 4.7683 },
  { icao: 'LEMD', iata: 'MAD', name: 'Adolfo Suárez Madrid-Barajas', lat: 40.4983, lon: -3.5676 },
  { icao: 'LIRF', iata: 'FCO', name: 'Leonardo da Vinci-Fiumicino', lat: 41.8003, lon: 12.2389 },
  { icao: 'LOWW', iata: 'VIE', name: 'Vienna International', lat: 48.1103, lon: 16.5697 },
  { icao: 'LSZH', iata: 'ZRH', name: 'Zurich Airport', lat: 47.4647, lon: 8.5492 },
  { icao: 'EDDM', iata: 'MUC', name: 'Munich Airport', lat: 48.3538, lon: 11.7861 },
  { icao: 'EDDB', iata: 'BER', name: 'Berlin Brandenburg', lat: 52.3667, lon: 13.5033 },
  { icao: 'LPPT', iata: 'LIS', name: 'Lisbon Portela', lat: 38.7742, lon: -9.1342 },
  { icao: 'EDDH', iata: 'HAM', name: 'Hamburg Airport', lat: 53.6304, lon: 9.9882 },
  { icao: 'EKCH', iata: 'CPH', name: 'Copenhagen Airport', lat: 55.6181, lon: 12.6561 },
  { icao: 'ESSA', iata: 'ARN', name: 'Stockholm Arlanda', lat: 59.6519, lon: 17.9186 },
];

async function main() {
  console.log('🌱 Seeding database...');

  // Create demo user
  const passwordHash = await hashPassword('demo123');
  const user = await prisma.user.upsert({
    where: { username: 'demo' },
    update: {},
    create: {
      username: 'demo',
      passwordHash,
    },
  });

  console.log(`✅ Created user: ${user.username}`);

  // Generate sample flights
  const flights = [];
  const airlines = [
    { name: 'Lufthansa', prefix: 'LH' },
    { name: 'British Airways', prefix: 'BA' },
    { name: 'Air France', prefix: 'AF' },
    { name: 'KLM', prefix: 'KL' },
    { name: 'Swiss', prefix: 'LX' },
  ];

  const aircraftTypes = ['A320', 'A321', 'B737', 'B738', 'A319', 'E190'];
  const statuses = ['scheduled', 'flown', 'flown', 'flown', 'cancelled']; // More flown flights

  // Create 50 sample flights
  for (let i = 0; i < 50; i++) {
    const depAirport = airports[Math.floor(Math.random() * airports.length)];
    let arrAirport = airports[Math.floor(Math.random() * airports.length)];

    // Ensure different airports
    while (arrAirport.icao === depAirport.icao) {
      arrAirport = airports[Math.floor(Math.random() * airports.length)];
    }

    const airline = airlines[Math.floor(Math.random() * airlines.length)];
    const flightNum = Math.floor(Math.random() * 9000) + 1000;
    const aircraft = aircraftTypes[Math.floor(Math.random() * aircraftTypes.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];

    // Random date in the last 6 months
    const daysAgo = Math.floor(Math.random() * 180);
    const departureTime = new Date();
    departureTime.setDate(departureTime.getDate() - daysAgo);
    departureTime.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));

    // Flight duration: 1-8 hours
    const durationHours = Math.random() * 7 + 1;
    const arrivalTime = new Date(departureTime.getTime() + durationHours * 60 * 60 * 1000);

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
      notes: i % 5 === 0 ? 'Sample flight note' : null,
    });
  }

  // Insert all flights
  await prisma.flight.createMany({
    data: flights,
  });

  console.log(`✅ Created ${flights.length} sample flights`);
  console.log('🎉 Seeding completed!');
  console.log('\nDemo credentials:');
  console.log('  Username: demo');
  console.log('  Password: demo123');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
