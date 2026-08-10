import { prisma } from './db';
import { hashPassword } from './utils/password';
import { deriveStayOverallRating } from './shared/ratingDerivation';

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

const providers = ['ollama', 'ollama', 'ollama', 'regex', 'regex', 'tesseract', 'openai', 'claude'];
const sourceTypes: Array<'email' | 'boardingpass'> = ['email', 'email', 'email', 'boardingpass', 'boardingpass'];

/**
 * Create demo parser feedback events
 */
async function createParserFeedbackEvents(userId: string) {
  // Check if feedback events already exist
  const existingFeedback = await prisma.analyticsEvent.count({
    where: {
      userId,
      type: 'parser_feedback',
    },
  });

  if (existingFeedback > 0) {
    console.log(`   Found ${existingFeedback} existing feedback events (skipping)`);
    return;
  }

  const feedbackEvents = [];
  const now = new Date();

  // Generate 18 feedback events over the last 60 days
  for (let i = 0; i < 18; i++) {
    const daysAgo = Math.floor(Math.random() * 60);
    const createdAt = new Date(now);
    createdAt.setDate(createdAt.getDate() - daysAgo);
    createdAt.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));

    const provider = providers[Math.floor(Math.random() * providers.length)];
    const sourceType = sourceTypes[Math.floor(Math.random() * sourceTypes.length)];

    // Generate sample flight data with intentional errors
    const airline = airlines[Math.floor(Math.random() * airlines.length)];
    const route = flightRoutes[Math.floor(Math.random() * flightRoutes.length)];
    const depAirport = airports.find(a => a.iata === route.dep)!;
    const arrAirport = airports.find(a => a.iata === route.arr)!;

    const flightNumber = airline.prefix + route.flightNum;
    const pnr = generatePNR();

    // Create original (incorrect) and corrected results
    const errorType = Math.floor(Math.random() * 4);
    let originalResult: Array<{
      flightNumber: string;
      departureCode: string;
      arrivalCode: string;
      departureTime: string;
      arrivalTime: string;
      pnr: string;
    }> = [];
    let correctedResult: typeof originalResult = [];
    let issues: string[] = [];
    let userCorrections: Array<{
      field: string;
      original: string;
      corrected: string;
    }> = [];
    let qualityScore = 30 + Math.floor(Math.random() * 65); // 30-95%

    switch (errorType) {
      case 0: // Flight number error
        originalResult = [{
          flightNumber: airline.prefix + (route.flightNum.slice(0, -1) + 'X'), // Wrong last digit
          departureCode: depAirport.iata,
          arrivalCode: arrAirport.iata,
          departureTime: new Date(createdAt).toISOString(),
          arrivalTime: new Date(createdAt.getTime() + route.duration * 60 * 60 * 1000).toISOString(),
          pnr: pnr,
        }];
        correctedResult = [{
          flightNumber: flightNumber,
          departureCode: depAirport.iata,
          arrivalCode: arrAirport.iata,
          departureTime: new Date(createdAt).toISOString(),
          arrivalTime: new Date(createdAt.getTime() + route.duration * 60 * 60 * 1000).toISOString(),
          pnr: pnr,
        }];
        issues.push(`Flight 1: flightNumber mismatch (${originalResult[0].flightNumber} → ${flightNumber})`);
        userCorrections.push({
          field: 'flight_0_flightNumber',
          original: originalResult[0].flightNumber,
          corrected: flightNumber,
        });
        break;

      case 1: { // Departure code error
        const wrongDep = airports.find(a => a.iata !== depAirport.iata && a.iata !== arrAirport.iata)!.iata;
        originalResult = [{
          flightNumber: flightNumber,
          departureCode: wrongDep,
          arrivalCode: arrAirport.iata,
          departureTime: new Date(createdAt).toISOString(),
          arrivalTime: new Date(createdAt.getTime() + route.duration * 60 * 60 * 1000).toISOString(),
          pnr: pnr,
        }];
        correctedResult = [{
          flightNumber: flightNumber,
          departureCode: depAirport.iata,
          arrivalCode: arrAirport.iata,
          departureTime: new Date(createdAt).toISOString(),
          arrivalTime: new Date(createdAt.getTime() + route.duration * 60 * 60 * 1000).toISOString(),
          pnr: pnr,
        }];
        issues.push(`Flight 1: departureCode mismatch (${wrongDep} → ${depAirport.iata})`);
        userCorrections.push({
          field: 'flight_0_departureCode',
          original: wrongDep,
          corrected: depAirport.iata,
        });
        break;
      }

      case 2: // PNR error
        originalResult = [{
          flightNumber: flightNumber,
          departureCode: depAirport.iata,
          arrivalCode: arrAirport.iata,
          departureTime: new Date(createdAt).toISOString(),
          arrivalTime: new Date(createdAt.getTime() + route.duration * 60 * 60 * 1000).toISOString(),
          pnr: 'XXXXXX', // Missing PNR
        }];
        correctedResult = [{
          flightNumber: flightNumber,
          departureCode: depAirport.iata,
          arrivalCode: arrAirport.iata,
          departureTime: new Date(createdAt).toISOString(),
          arrivalTime: new Date(createdAt.getTime() + route.duration * 60 * 60 * 1000).toISOString(),
          pnr: pnr,
        }];
        issues.push(`Flight 1: pnr mismatch (XXXXXX → ${pnr})`);
        userCorrections.push({
          field: 'flight_0_pnr',
          original: 'XXXXXX',
          corrected: pnr,
        });
        break;

      case 3: // Multiple errors
        originalResult = [{
          flightNumber: airline.prefix + '9999', // Wrong flight number
          departureCode: 'XXX', // Wrong departure
          arrivalCode: arrAirport.iata,
          departureTime: new Date(createdAt).toISOString(),
          arrivalTime: new Date(createdAt.getTime() + route.duration * 60 * 60 * 1000).toISOString(),
          pnr: '',
        }];
        correctedResult = [{
          flightNumber: flightNumber,
          departureCode: depAirport.iata,
          arrivalCode: arrAirport.iata,
          departureTime: new Date(createdAt).toISOString(),
          arrivalTime: new Date(createdAt.getTime() + route.duration * 60 * 60 * 1000).toISOString(),
          pnr: pnr,
        }];
        issues.push(`Flight 1: flightNumber mismatch (${originalResult[0].flightNumber} → ${flightNumber})`);
        issues.push(`Flight 1: departureCode mismatch (XXX → ${depAirport.iata})`);
        issues.push(`Flight 1: pnr mismatch ( → ${pnr})`);
        userCorrections.push(
          { field: 'flight_0_flightNumber', original: originalResult[0].flightNumber, corrected: flightNumber },
          { field: 'flight_0_departureCode', original: 'XXX', corrected: depAirport.iata },
          { field: 'flight_0_pnr', original: '', corrected: pnr }
        );
        qualityScore = 20 + Math.floor(Math.random() * 20); // Lower quality for multiple errors
        break;
    }

    const originalData = sourceType === 'email'
      ? {
          subject: `Your ${airline.name} Flight ${flightNumber} Confirmation`,
          text: `Flight ${flightNumber} from ${depAirport.iata} to ${arrAirport.iata}`,
          html: `<p>Flight ${flightNumber} from ${depAirport.iata} to ${arrAirport.iata}</p>`,
        }
      : {
          imageBase64: `hash:demo_boarding_pass_${i}`,
        };

    feedbackEvents.push({
      userId,
      type: 'parser_feedback',
      payload: {
        sourceType,
        provider,
        originalData,
        parsedResult: originalResult,
        correctedResult,
        qualityScore,
        issues,
        userCorrections,
        timestamp: createdAt.toISOString(),
      },
      createdAt,
    });
  }

  // Insert in batches
  const batchSize = 5;
  for (let i = 0; i < feedbackEvents.length; i += batchSize) {
    const batch = feedbackEvents.slice(i, i + batchSize);
    await prisma.analyticsEvent.createMany({
      data: batch,
    });
  }

  console.log(`   Created ${feedbackEvents.length} parser feedback events`);
}

/**
 * Generate a random PNR (6-8 alphanumeric characters)
 */
function generatePNR(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const length = 6 + Math.floor(Math.random() * 3); // 6-8 characters
  let pnr = '';
  for (let i = 0; i < length; i++) {
    pnr += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pnr;
}

/**
 * Create demo pattern suggestions
 */
async function createPatternSuggestions(userId: string) {
  // Check if pattern suggestions already exist
  const existingSuggestions = await prisma.analyticsEvent.count({
    where: {
      type: 'pattern_suggestion',
    },
  });

  if (existingSuggestions > 0) {
    console.log(`   Found ${existingSuggestions} existing pattern suggestions (skipping)`);
    return;
  }

  const now = new Date();
  const suggestions = [
    {
      field: 'flightNumber',
      pattern: '\\b([A-Z]{2,3})\\s*(\\d{3,4})\\b',
      confidence: 0.92,
      examples: ['LH1234', 'BA567', 'EK8901', 'AF2345', 'LX678'],
      issue: 'Missing or incorrect flight number',
      createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    },
    {
      field: 'pnr',
      pattern: '\\b([A-Z0-9]{6,8})\\b',
      confidence: 0.88,
      examples: ['ABC123', 'XYZ789', 'DEF456', 'GHI012'],
      issue: 'Missing or incorrect PNR',
      createdAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
    },
    {
      field: 'departureCode',
      pattern: '\\b([A-Z]{3})\\b',
      confidence: 0.75,
      examples: ['MUC', 'FRA', 'LHR', 'CDG', 'AMS'],
      issue: 'Missing or incorrect departure airport code',
      createdAt: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
    },
    {
      field: 'arrivalCode',
      pattern: '\\b([A-Z]{3})\\b',
      confidence: 0.73,
      examples: ['JFK', 'LAX', 'SFO', 'DXB', 'SIN'],
      issue: 'Missing or incorrect arrival airport code',
      createdAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000), // 20 days ago
    },
    {
      field: 'flightNumber',
      pattern: '\\b([A-Z]{2})\\s*(\\d{4})\\b',
      confidence: 0.95,
      examples: ['LH1234', 'BA5678', 'EK9012', 'AF3456'],
      issue: 'Missing or incorrect flight number (2-letter airline codes)',
      createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    },
    {
      field: 'pnr',
      pattern: '\\b([A-Z]{6})\\b',
      confidence: 0.70,
      examples: ['ABCDEF', 'GHIJKL', 'MNOPQR'],
      issue: 'Missing or incorrect PNR (6-letter format)',
      createdAt: new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000), // 25 days ago
    },
    {
      field: 'flightNumber',
      pattern: '\\b([A-Z]{3})\\s*(\\d{3})\\b',
      confidence: 0.85,
      examples: ['UAE123', 'QTR456', 'SIA789'],
      issue: 'Missing or incorrect flight number (3-letter airline codes)',
      createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    },
    {
      field: 'departureCode',
      pattern: 'Departure:\\s*([A-Z]{3})',
      confidence: 0.80,
      examples: ['MUC', 'FRA', 'LHR'],
      issue: 'Missing or incorrect departure airport code (with label)',
      createdAt: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000), // 12 days ago
    },
  ];

  for (const suggestion of suggestions) {
    await prisma.analyticsEvent.create({
      data: {
        userId: userId, // Use the provided userId parameter instead of hardcoded 'system'
        type: 'pattern_suggestion',
        payload: {
          field: suggestion.field,
          pattern: suggestion.pattern,
          confidence: suggestion.confidence,
          examples: suggestion.examples,
          issue: suggestion.issue,
          applied: false,
          createdAt: suggestion.createdAt.toISOString(),
        },
        createdAt: suggestion.createdAt,
      },
    });
  }

  console.log(`   Created ${suggestions.length} pattern suggestions`);
}

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

  // Skandinavien-interne Verbindungen (für Skandinavien Tour)
  { dep: 'CPH', arr: 'ARN', airline: 'SAS', flightNum: '505', duration: 1.3 },
  { dep: 'ARN', arr: 'OSL', airline: 'SAS', flightNum: '502', duration: 1.2 },
  { dep: 'OSL', arr: 'MUC', airline: 'Lufthansa', flightNum: '2447', duration: 2.2 },

  // Rückflüge
  { dep: 'JFK', arr: 'MUC', airline: 'Lufthansa', flightNum: '411', duration: 8 },
  { dep: 'LAX', arr: 'FRA', airline: 'Lufthansa', flightNum: '453', duration: 10.5 },
  { dep: 'FRA', arr: 'MUC', airline: 'Lufthansa', flightNum: '115', duration: 1 },
  { dep: 'HND', arr: 'MUC', airline: 'Lufthansa', flightNum: '715', duration: 12 },
  { dep: 'BCN', arr: 'MUC', airline: 'Lufthansa', flightNum: '1811', duration: 2 },
  { dep: 'DXB', arr: 'SIN', airline: 'Emirates', flightNum: '352', duration: 7 },
  { dep: 'SIN', arr: 'MUC', airline: 'Singapore Airlines', flightNum: '327', duration: 13 },
  { dep: 'DXB', arr: 'MUC', airline: 'Emirates', flightNum: '051', duration: 6 },
  { dep: 'SYD', arr: 'DXB', airline: 'Emirates', flightNum: '412', duration: 14 },
  { dep: 'DXB', arr: 'MUC', airline: 'Emirates', flightNum: '053', duration: 6 },
];

async function createDemoTrips(userId: string): Promise<void> {
  // Skip if trips already exist
  const existing = await prisma.trip.count({ where: { userId } });
  if (existing > 0) {
    console.log(`   Found ${existing} existing trips (skipping)`);
    return;
  }

  // Trip definitions: each specifies a color, optional booking, and route pairs to find
  const tripDefs = [
    {
      name: 'New York Business Trip',
      color: '#38bdf8',
      pnr: 'LH4Z9X',
      price: 1490,
      currency: 'EUR',
      routePairs: [
        { depIata: 'MUC', arrIata: 'JFK' },
        { depIata: 'JFK', arrIata: 'MUC' },
      ],
    },
    {
      name: 'Tokyo · Japan',
      color: '#f472b6',
      pnr: 'LH7K2M',
      price: 2240,
      currency: 'EUR',
      routePairs: [
        { depIata: 'MUC', arrIata: 'HND' },
        { depIata: 'HND', arrIata: 'MUC' },
      ],
    },
    {
      name: 'Dubai & Singapur',
      color: '#fb923c',
      pnr: 'EK3T7P',
      price: 1870,
      currency: 'EUR',
      routePairs: [
        { depIata: 'MUC', arrIata: 'DXB' },
        { depIata: 'DXB', arrIata: 'SIN' },
        { depIata: 'SIN', arrIata: 'MUC' },
      ],
    },
    {
      name: 'Skandinavien Tour',
      color: '#818cf8',
      // No booking — manual trip grouping
      pnr: undefined,
      price: undefined,
      currency: undefined,
      routePairs: [
        { depIata: 'MUC', arrIata: 'CPH' },
        { depIata: 'CPH', arrIata: 'ARN' },
        { depIata: 'ARN', arrIata: 'OSL' },
        { depIata: 'OSL', arrIata: 'MUC' },
      ],
    },
    {
      name: 'Barcelona Wochenende',
      color: '#34d399',
      pnr: 'LH9W5R',
      price: 219,
      currency: 'EUR',
      routePairs: [
        { depIata: 'MUC', arrIata: 'BCN' },
        { depIata: 'BCN', arrIata: 'MUC' },
      ],
    },
  ];

  let createdCount = 0;

  for (const def of tripDefs) {
    // Find one unused flight per route pair
    const flightIds: string[] = [];
    for (const pair of def.routePairs) {
      const flight = await prisma.flight.findFirst({
        where: { userId, depIata: pair.depIata, arrIata: pair.arrIata, tripId: null },
        orderBy: { departureTime: 'asc' },
        select: { id: true },
      });
      if (flight) flightIds.push(flight.id);
    }

    if (flightIds.length === 0) {
      console.log(`   Skipping "${def.name}" — no matching flights found`);
      continue;
    }

    // Create trip
    const trip = await prisma.trip.create({
      data: { userId, name: def.name, color: def.color },
    });

    // Create booking (only if price/PNR defined)
    let bookingId: string | null = null;
    if (def.pnr !== undefined) {
      const booking = await prisma.booking.create({
        data: {
          userId,
          tripId: trip.id,
          pnr: def.pnr,
          price: def.price ?? null,
          currency: def.currency ?? 'EUR',
        },
      });
      bookingId = booking.id;
    }

    // Link flights to trip (and optionally booking)
    await prisma.flight.updateMany({
      where: { id: { in: flightIds } },
      data: {
        tripId: trip.id,
        ...(bookingId ? { bookingId } : {}),
      },
    });

    console.log(`   ✅ "${def.name}" — ${flightIds.length} flight(s)${def.pnr ? `, PNR ${def.pnr}` : ' (manual)'}`);
    createdCount++;
  }

  console.log(`   Created ${createdCount} trips`);
}

/**
 * Demo lodging data: hotels, stays, one loyalty membership. Without this the
 * lodging area of every preview/demo instance was EMPTY — testers had to type
 * hotels by hand before they could judge the feature at all.
 *
 * Deliberate variety, one row per UI state worth demoing:
 *  - chain hotel with membership (Hilton Tokyo → Hilton Honors)
 *  - chain hotel whose stay OPTED OUT of the programme (Marriott NYC)
 *  - independent hotel, priced per night only (exercises the total fallback)
 *  - standalone stay on no trip at all
 */
async function createDemoLodging(userId: string): Promise<void> {
  const existing = await prisma.lodging.count({ where: { userId } });
  if (existing > 0) {
    console.log(`   Found ${existing} existing lodgings (skipping)`);
    return;
  }

  // Make the domain visible: without this the demo account hides the entire
  // lodging area behind a settings toggle nobody knows about.
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const domains = new Set([...(settings?.enabledDomains ?? ['flight']), 'lodging']);
  await prisma.userSettings.upsert({
    where: { userId },
    update: { enabledDomains: [...domains] },
    create: { userId, enabledDomains: [...domains], data: {} },
  });

  // Chain lookups — the catalog seed runs at boot; a missing chain just means
  // the hotel is created chainless rather than the seed failing.
  const hilton = await prisma.lodgingChain.findFirst({ where: { name: 'Hilton' } });
  const marriott = await prisma.lodgingChain.findFirst({ where: { name: 'Marriott' } });

  /** The stay should sit INSIDE its trip's flight window, so the timeline
   *  reads as one journey rather than a hotel floating outside the flights. */
  // Prefer a trip by name, but fall back to any multi-flight trip not already
  // used. Older demo-seed generations named the trips differently ("Japan
  // 2022" vs "Tokyo · Japan"), and on the beta box the exact-name lookup
  // silently produced 1 of 4 hotels. Names are a nice-to-have here; the
  // guarantee that matters is that three stays land on three distinct trips.
  const usedTripIds = new Set<string>();
  const tripWindow = async (
    preferredName: string,
  ): Promise<{ tripId: string; from: Date; to: Date } | null> => {
    const named = await prisma.trip.findFirst({
      where: { userId, name: preferredName },
      select: { id: true },
    });
    const candidates = named
      ? [named]
      : await prisma.trip.findMany({ where: { userId }, select: { id: true }, orderBy: { createdAt: 'asc' } });

    for (const trip of candidates) {
      if (usedTripIds.has(trip.id)) continue;
      const flights = await prisma.flight.findMany({
        where: { tripId: trip.id },
        orderBy: { departureTime: 'asc' },
        select: { departureTime: true, arrivalTime: true },
      });
      if (flights.length < 2) continue;
      const from = flights[0].arrivalTime ?? flights[0].departureTime;
      const to = flights[flights.length - 1].departureTime;
      if (!from || !to) continue;
      usedTripIds.add(trip.id);
      return { tripId: trip.id, from: new Date(from), to: new Date(to) };
    }
    return null;
  };

  const day = 24 * 60 * 60 * 1000;
  const dateOnly = (d: Date): Date => new Date(d.toISOString().slice(0, 10));
  let stays = 0;

  // 1. Chain hotel + membership, fully rated, total price typed.
  const tokyo = await tripWindow('Tokyo · Japan');
  if (tokyo) {
    const hotel = await prisma.lodging.create({
      data: {
        userId,
        name: 'Hilton Tokyo',
        type: 'hotel',
        chainId: hilton?.id ?? null,
        city: 'Tokyo',
        country: 'JP',
        lat: 35.6926,
        lon: 139.6921,
        stars: 4,
        dataSource: 'manual',
      },
    });
    // The demo trips pair the EARLIEST matching outbound with the earliest
    // return, which can be years apart — the stay clamps to a hotel-plausible
    // length instead of spanning that whole window.
    const checkIn = dateOnly(new Date(tokyo.from.getTime() + day));
    const checkOut = dateOnly(new Date(checkIn.getTime() + 3 * day));
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: hotel.id,
        tripId: tokyo.tripId,
        checkIn,
        checkOut,
        status: 'completed',
        roomCategory: 'King Deluxe',
        board: 'breakfast',
        totalPrice: 1120,
        currency: 'EUR',
        ratingRoom: 5,
        ratingBreakfast: 4,
        ratingService: 5,
        ratingOverall: deriveStayOverallRating({ room: 5, breakfast: 4, service: 5 }),
      },
    });
    stays++;

    if (hilton) {
      const membership = await prisma.lodgingMembership.upsert({
        where: { userId_programName: { userId, programName: 'Hilton Honors' } },
        update: {},
        create: {
          userId,
          programName: 'Hilton Honors',
          membershipNumber: 'HH-847291035',
          tier: 'Gold',
        },
      });
      await prisma.lodgingMembershipChain.upsert({
        where: { membershipId_chainId: { membershipId: membership.id, chainId: hilton.id } },
        update: {},
        create: { membershipId: membership.id, chainId: hilton.id },
      });
    }
  }

  // 2. Chain hotel whose stay opted OUT of the programme.
  const nyc = await tripWindow('New York Business Trip');
  if (nyc) {
    const hotel = await prisma.lodging.create({
      data: {
        userId,
        name: 'New York Marriott Marquis',
        type: 'hotel',
        chainId: marriott?.id ?? null,
        city: 'New York',
        country: 'US',
        lat: 40.7589,
        lon: -73.9861,
        stars: 4,
        dataSource: 'manual',
      },
    });
    const checkIn = dateOnly(nyc.from);
    const checkOut = dateOnly(new Date(checkIn.getTime() + 3 * day));
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: hotel.id,
        tripId: nyc.tripId,
        checkIn,
        checkOut,
        status: 'completed',
        board: 'none',
        totalPrice: 780,
        currency: 'USD',
        membershipOptOut: true,
        ratingRoom: 4,
        ratingService: 3,
        ratingOverall: deriveStayOverallRating({ room: 4, breakfast: null, service: 3 }),
      },
    });
    stays++;
  }

  // 3. Independent hotel, per-night price only — no chain, no programme.
  const barcelona = await tripWindow('Barcelona Wochenende');
  if (barcelona) {
    const hotel = await prisma.lodging.create({
      data: {
        userId,
        name: 'Casa Mirador',
        type: 'guesthouse',
        city: 'Barcelona',
        country: 'ES',
        lat: 41.3874,
        lon: 2.1686,
        stars: 3,
        dataSource: 'manual',
      },
    });
    const checkIn = dateOnly(barcelona.from);
    const checkOut = dateOnly(new Date(checkIn.getTime() + 2 * day));
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: hotel.id,
        tripId: barcelona.tripId,
        checkIn,
        checkOut,
        status: 'completed',
        board: 'breakfast',
        pricePerNight: 95,
        currency: 'EUR',
        ratingRoom: 4,
        ratingBreakfast: 5,
        ratingOverall: deriveStayOverallRating({ room: 4, breakfast: 5, service: null }),
      },
    });
    stays++;
  }

  // 4. A stay on no trip at all — the unassigned state.
  const vienna = await prisma.lodging.create({
    data: {
      userId,
      name: 'Pension Alpenblick',
      type: 'guesthouse',
      city: 'Vienna',
      country: 'AT',
      lat: 48.2082,
      lon: 16.3738,
      stars: 3,
      dataSource: 'manual',
    },
  });
  await prisma.lodgingStay.create({
    data: {
      userId,
      lodgingId: vienna.id,
      checkIn: new Date('2024-09-13'),
      checkOut: new Date('2024-09-15'),
      status: 'completed',
      totalPrice: 210,
      currency: 'EUR',
    },
  });
  stays++;

  const lodgings = await prisma.lodging.count({ where: { userId } });
  console.log(`   ✅ Created ${lodgings} lodgings, ${stays} stays`);
}

export interface SeedDemoOptions {
  username?: string;
  password?: string;
  isAdmin?: boolean;
  /**
   * If true, reset the password + admin flag on an existing user with this
   * username. Used by the dev-admin seed so a forgotten admin password can
   * be recovered idempotently.
   */
  resetCredentials?: boolean;
}

export async function seedDemoUser(options: SeedDemoOptions = {}) {
  const username = options.username ?? 'demo';
  const password = options.password ?? 'demo123';
  const isAdmin = options.isAdmin ?? false;
  const resetCredentials = options.resetCredentials ?? false;

  console.log(`🔐 Creating ${isAdmin ? 'admin' : 'demo'} user "${username}" with sample flights...`);

  try {
    // Check if user already exists
    let demoUser = await prisma.user.findUnique({
      where: { username },
    });

    if (!demoUser) {
      // Create user
      const passwordHash = await hashPassword(password);
      demoUser = await prisma.user.create({
        data: {
          username,
          passwordHash,
          isAdmin,
          mustChangePassword: false,
          isDemo: true,
        },
      });

      console.log(`✅ User "${username}" created`);
      console.log(`   Username: ${username}`);
      console.log(`   Password: ${password}`);
      if (isAdmin) console.log('   Role:     ADMIN');
      console.log('');
      console.log('✈️  Creating 120 sample flights...');
    } else {
      console.log(`✅ User "${username}" already exists`);

      if (resetCredentials) {
        const passwordHash = await hashPassword(password);
        demoUser = await prisma.user.update({
          where: { id: demoUser.id },
          data: {
            passwordHash,
            isAdmin,
            mustChangePassword: false,
            isDemo: true,
          },
        });
        console.log(`🔄 Reset credentials → password: ${password}, isAdmin: ${isAdmin}`);
      }
      console.log('');

      // Check if flights already exist
      const existingFlights = await prisma.flight.count({
        where: { userId: demoUser.id },
      });

      if (existingFlights > 0) {
        console.log(`   Found ${existingFlights} existing flights`);
        console.log('');
      } else {
        console.log('✈️  Creating sample flights...');
      }
    }

    // Build the flight plan with a real frequency spread so the route-
    // frequency heatmap shows a gradient (heavy commuter routes → hot,
    // one-off long-hauls → cold) instead of a flat 2-3 per route. A handful
    // of upcoming (scheduled) flights exercise the two-tone status colors.
    const now = new Date();
    const startDate = new Date('2021-01-01');
    const pastEnd = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

    // How many times each dep-arr route was flown (the heatmap's spread).
    const routeFreq: Record<string, number> = {
      'MUC-VIE': 9, 'MUC-ZRH': 8, 'MUC-FRA': 8, 'MUC-LHR': 7, 'MUC-CDG': 6,
      'MUC-AMS': 5, 'MUC-PRG': 5, 'MUC-BCN': 5, 'BCN-MUC': 4, 'MUC-FCO': 4,
      'MUC-CPH': 4, 'MUC-MAD': 3, 'MUC-WAW': 3, 'MUC-BUD': 3, 'FRA-MUC': 3,
      'MUC-ARN': 2, 'MUC-OSL': 2, 'MUC-ATH': 2, 'MUC-IST': 2, 'MUC-LIS': 2,
      'MUC-JFK': 2, 'JFK-MUC': 2, 'MUC-DXB': 2, 'DXB-MUC': 2, 'MUC-HND': 2,
      'HND-MUC': 2, 'FRA-JFK': 2, 'MUC-ORD': 1, 'MUC-YYZ': 1, 'MUC-SIN': 1,
      'MUC-BKK': 1, 'MUC-HKG': 1, 'FRA-LAX': 1, 'FRA-SFO': 1, 'LAX-FRA': 1,
      'CPH-ARN': 1, 'ARN-OSL': 1, 'OSL-MUC': 1, 'SIN-MUC': 1, 'DXB-SIN': 1,
      'SYD-DXB': 1,
    };

    // Upcoming (scheduled) flights — future dates, so the two-tone status
    // coloring (past vs upcoming) has something to show.
    const upcomingRoutes: Array<{
      dep: string; arr: string; airline: string; flightNum: string; duration: number; daysAhead: number;
    }> = [
      { dep: 'MUC', arr: 'VIE', airline: 'Lufthansa', flightNum: '2280', duration: 0.8, daysAhead: 12 },
      { dep: 'MUC', arr: 'LHR', airline: 'Lufthansa', flightNum: '2470', duration: 2, daysAhead: 21 },
      { dep: 'MUC', arr: 'JFK', airline: 'Lufthansa', flightNum: '410', duration: 9.5, daysAhead: 34 },
      { dep: 'JFK', arr: 'MUC', airline: 'Lufthansa', flightNum: '411', duration: 8, daysAhead: 41 },
      { dep: 'MUC', arr: 'BCN', airline: 'Lufthansa', flightNum: '1810', duration: 2, daysAhead: 62 },
      { dep: 'BCN', arr: 'MUC', airline: 'Lufthansa', flightNum: '1811', duration: 2, daysAhead: 64 },
      { dep: 'MUC', arr: 'DXB', airline: 'Emirates', flightNum: '050', duration: 6, daysAhead: 95 },
      { dep: 'MUC', arr: 'CPH', airline: 'Lufthansa', flightNum: '2462', duration: 1.5, daysAhead: 120 },
    ];

    type PlanItem = {
      dep: string; arr: string; airline: string; flightNum: string;
      duration: number; status: 'flown' | 'scheduled'; daysAhead?: number;
    };
    const plan: PlanItem[] = [];
    for (const [key, freq] of Object.entries(routeFreq)) {
      const [dep, arr] = key.split('-');
      const route = flightRoutes.find(r => r.dep === dep && r.arr === arr);
      if (!route) continue;
      for (let n = 0; n < freq; n++) {
        plan.push({
          dep: route.dep, arr: route.arr, airline: route.airline,
          flightNum: route.flightNum, duration: route.duration, status: 'flown',
        });
      }
    }
    for (const u of upcomingRoutes) {
      plan.push({ ...u, status: 'scheduled' });
    }

    const flights = plan.map((item) => {
      const airline = airlines.find(a => a.name === item.airline) || airlines[0];

      let departureTime: Date;
      if (item.status === 'scheduled' && item.daysAhead != null) {
        departureTime = new Date(now.getTime() + item.daysAhead * 24 * 60 * 60 * 1000);
      } else {
        departureTime = new Date(startDate.getTime() + Math.random() * (pastEnd.getTime() - startDate.getTime()));
      }
      departureTime.setHours(Math.floor(Math.random() * 20) + 4, Math.floor(Math.random() * 60), 0, 0);

      const arrivalTime = new Date(departureTime);
      arrivalTime.setHours(arrivalTime.getHours() + Math.floor(item.duration));
      arrivalTime.setMinutes(arrivalTime.getMinutes() + Math.floor((item.duration % 1) * 60));

      const depAirport = airports.find(a => a.iata === item.dep)!;
      const arrAirport = airports.find(a => a.iata === item.arr)!;

      const seatClass = classes[Math.floor(Math.random() * classes.length)];
      const category = categories[Math.floor(Math.random() * categories.length)];
      const aircraft = airline.aircraft[Math.floor(Math.random() * airline.aircraft.length)];

      return {
        userId: demoUser.id,
        airline: airline.name,
        flightNumber: airline.prefix + item.flightNum,
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
        status: item.status,
        seatClass,
        category,
        seatNumber: `${Math.floor(Math.random() * 40) + 1}${String.fromCharCode(65 + Math.floor(Math.random() * 6))}`,
        gate: `${String.fromCharCode(65 + Math.floor(Math.random() * 10))}${Math.floor(Math.random() * 30) + 1}`,
        terminal: Math.floor(Math.random() * 3) + 1 + '',
      };
    });

    // Sort by date
    flights.sort((a, b) => a.departureTime.getTime() - b.departureTime.getTime());

    // Insert flights in batches (only if they don't exist)
    const existingFlights = await prisma.flight.count({
      where: { userId: demoUser.id },
    });

    if (existingFlights === 0) {
      const batchSize = 20;
      for (let i = 0; i < flights.length; i += batchSize) {
        const batch = flights.slice(i, i + batchSize);
        await prisma.flight.createMany({
          data: batch,
        });
        console.log(`   Created flights ${i + 1}-${Math.min(i + batchSize, flights.length)} of ${flights.length}`);
      }
      console.log('');
      const upcomingCount = flights.filter(f => f.status === 'scheduled').length;
      console.log(`✅ Created ${flights.length} flights (${upcomingCount} upcoming) across a weighted route mix`);
    }

    // Create parser feedback events
    console.log('📊 Creating parser feedback events...');
    await createParserFeedbackEvents(demoUser.id);

    // Create pattern suggestions
    console.log('🔍 Creating pattern suggestions...');
    await createPatternSuggestions(demoUser.id);

    // Create demo trips
    console.log('🗺  Creating demo trips...');
    await createDemoTrips(demoUser.id);

    // Create demo lodging (after trips, so stays can sit inside trip windows)
    console.log('🏨 Creating demo lodging...');
    await createDemoLodging(demoUser.id);

    console.log('');
    console.log(`✅ User "${username}" setup complete!`);
    console.log('   Main hub: Munich (MUC)');
    console.log('   Routes: Europe, Americas, Asia, Oceania, Africa');
  } catch (error) {
    console.error(`❌ Failed to create user "${username}":`, error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run as default-demo when executed directly (npm run seed:demo)
if (require.main === module) {
  seedDemoUser();
}
