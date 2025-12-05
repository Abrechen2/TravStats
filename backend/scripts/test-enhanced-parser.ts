/**
 * Direct test script for the Enhanced LLM Parser
 *
 * Usage:
 *   npm run test:parser
 */

import { parseEmailWithLLM, isOllamaAvailable, ensureModelAvailable } from '../src/services/llmParser.enhanced';

const TEST_EMAILS = [
  {
    name: '🇩🇪 Lufthansa Hin- und Rückflug',
    subject: 'Ihre Buchungsbestätigung - Lufthansa',
    text: `Sehr geehrter Herr Müller,

Ihre Buchung wurde erfolgreich abgeschlossen!

Buchungscode: 9RFAA7
Preis: 513,47 EUR

Hinflug:
Flugnummer: LH103
Von: München (MUC)
Nach: Luxemburg (LUX)
Datum: Montag, 18. November 2025
Abflug: 11:00 Uhr
Ankunft: 12:55 Uhr
Sitzplatz: 26F
Terminal: 2

Rückflug:
Flugnummer: LH442
Von: Luxemburg (LUX)
Nach: München (MUC)
Datum: Mittwoch, 20. November 2025
Abflug: 09:30 Uhr
Ankunft: 10:35 Uhr

Mit freundlichen Grüßen
Lufthansa Team`,
  },
  {
    name: '🇬🇧 Ryanair One-Way',
    subject: 'Ryanair Booking Confirmation',
    text: `Your booking has been confirmed!

Booking Reference: ABC123
Total: €49.99

Flight Details:
Flight: FR8234
Route: Berlin (BER) → London (STN)
Date: 15 Dec 2025
Departure: 06:15
Arrival: 07:30
Seat: 15A

Download your boarding pass 48h before departure.

Ryanair`,
  },
  {
    name: '✈️ Multi-Leg Bangkok',
    subject: 'Ihre Reise Frankfurt - Bangkok',
    text: `Buchungsbestätigung PNR: XYZ789

1. Flug: LH712
   Frankfurt (FRA) → Bangkok (BKK)
   15.01.2026, 22:10 → 16.01.2026, 14:35

2. Flug: TG417
   Bangkok (BKK) → Phuket (HKT)
   16.01.2026, 18:30 → 19:50

Gesamtpreis: 1.249,00 EUR`,
  },
];

function printSeparator(char = '=', length = 70) {
  console.log(char.repeat(length));
}

function printFlight(flight: any, index: number, total: number) {
  console.log(`\n   ✈️  Flight ${index + 1}/${total}:`);
  console.log(`      Flight Number:  ${flight.flightNumber || '❌ MISSING'}`);
  console.log(`      Route:          ${flight.departureCode || '???'} → ${flight.arrivalCode || '???'}`);
  console.log(`      Departure:      ${flight.departureTime || '❌ MISSING'}`);
  console.log(`      Arrival:        ${flight.arrivalTime || 'N/A'}`);
  console.log(`      PNR:            ${flight.pnr || 'N/A'}`);
  console.log(`      Seat:           ${flight.seat || 'N/A'}`);
  console.log(`      Terminal:       ${flight.terminal || 'N/A'}`);
  console.log(`      Gate:           ${flight.gate || 'N/A'}`);
  console.log(`      Price:          ${flight.price ? `${flight.price} ${flight.currency || ''}` : 'N/A'}`);

  if (flight.missing && flight.missing.length > 0) {
    console.log(`      ⚠️  Missing:      ${flight.missing.join(', ')}`);
  }
}

async function testEmail(email: typeof TEST_EMAILS[0], testNumber: number) {
  console.log(`\n${testNumber}. Testing: ${email.name}`);
  printSeparator('-');
  console.log(`   Subject: "${email.subject}"`);
  console.log(`   Email length: ${email.text.length} characters\n`);

  const startTime = Date.now();

  try {
    const results = await parseEmailWithLLM(email.subject, email.text);
    const duration = Date.now() - startTime;

    console.log(`   ✅ Parsing completed in ${duration}ms`);
    console.log(`   📊 Found ${results.length} flight(s)`);

    if (results.length === 0) {
      console.log(`   ⚠️  No flights extracted!`);
    } else {
      results.forEach((flight, idx) => {
        printFlight(flight, idx, results.length);
      });
    }

    return {
      success: true,
      flightsFound: results.length,
      duration,
      results,
    };

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.log(`   ❌ Parsing failed after ${duration}ms`);
    console.log(`   Error: ${error.message}`);

    return {
      success: false,
      flightsFound: 0,
      duration,
      error: error.message,
    };
  }
}

async function main() {
  console.log('\n🚀 TravStats Enhanced Parser Test\n');
  printSeparator();

  // Check Ollama connection
  console.log('\n📡 Checking Ollama connection...');
  const available = await isOllamaAvailable();

  if (!available) {
    console.error('❌ Cannot connect to Ollama');
    console.error('   Make sure Ollama is running: ollama serve');
    console.error('   Or check OLLAMA_URL in your .env\n');
    process.exit(1);
  }

  console.log('✅ Connected to Ollama');

  // Ensure model is available
  console.log('\n🔍 Checking model availability...');
  const modelReady = await ensureModelAvailable();

  if (!modelReady) {
    console.error('❌ Model not available');
    console.error('   Current model: ' + (process.env.OLLAMA_MODEL || 'llama3.2:3b'));
    console.error('   Try: ollama pull ' + (process.env.OLLAMA_MODEL || 'llama3.2:3b') + '\n');
    process.exit(1);
  }

  console.log('✅ Model ready: ' + (process.env.OLLAMA_MODEL || 'llama3.2:3b'));

  // Run tests
  console.log('\n🧪 Running parser tests...');
  printSeparator();

  const results = [];
  for (let i = 0; i < TEST_EMAILS.length; i++) {
    const result = await testEmail(TEST_EMAILS[i], i + 1);
    results.push(result);

    // Small delay between tests
    if (i < TEST_EMAILS.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Summary
  console.log('\n\n📊 SUMMARY');
  printSeparator();

  const totalFlights = results.reduce((sum, r) => sum + r.flightsFound, 0);
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const successRate = (results.filter(r => r.success).length / results.length) * 100;

  console.log(`\n   Total emails tested:  ${results.length}`);
  console.log(`   Total flights found:  ${totalFlights}`);
  console.log(`   Success rate:         ${successRate.toFixed(1)}%`);
  console.log(`   Average duration:     ${avgDuration.toFixed(0)}ms`);

  console.log('\n   Results per email:');
  results.forEach((result, idx) => {
    const icon = result.success ? '✅' : '❌';
    const email = TEST_EMAILS[idx];
    console.log(`   ${icon} ${email.name}: ${result.flightsFound} flights (${result.duration}ms)`);
  });

  // Recommendations
  console.log('\n\n💡 TIPS FOR BETTER RESULTS');
  printSeparator();

  if (avgDuration > 2000) {
    console.log('\n   ⚡ Model is slow (>2s per email)');
    console.log('      Consider using a faster model like llama3.2:3b');
  }

  if (totalFlights < TEST_EMAILS.length * 1.5) {
    console.log('\n   🎯 Detection rate could be better');
    console.log('      Consider upgrading to a larger model:');
    console.log('      • qwen2.5:7b - Excellent for structured data');
    console.log('      • mistral:7b - Great multilingual support');
    console.log('      Download: ollama pull qwen2.5:7b');
  }

  console.log('\n   📝 To change model, update your .env:');
  console.log('      OLLAMA_MODEL=qwen2.5:7b');

  console.log('\n✨ Done!\n');
}

// Run
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
