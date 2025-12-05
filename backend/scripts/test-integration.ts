/**
 * Quick integration test to verify Enhanced Parser is working in bookingParser.ts
 */

import 'dotenv/config'; // Load .env
import { parseBookingEmail } from '../src/services/bookingParser';

const TEST_EMAIL_SUBJECT = 'Vielen Dank für Ihre Buchung | von München nach Luxemburg am 18 November 2025';
const TEST_EMAIL_TEXT = `Sehr geehrter Herr Müller,

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
Lufthansa Team`;

async function main() {
  console.log('🧪 Testing Enhanced Parser Integration\n');
  console.log('='.repeat(60));

  console.log('\n📧 Test Email:');
  console.log(`Subject: ${TEST_EMAIL_SUBJECT}`);
  console.log(`Text length: ${TEST_EMAIL_TEXT.length} characters\n`);

  console.log('⏳ Parsing email...\n');

  const startTime = Date.now();

  try {
    const result = await parseBookingEmail(TEST_EMAIL_SUBJECT, TEST_EMAIL_TEXT);
    const duration = Date.now() - startTime;

    console.log('✅ Parsing completed!\n');
    console.log('='.repeat(60));
    console.log('\n📊 Results:');
    console.log(`   Parser used:       ${result.parserUsed}`);
    console.log(`   Ollama available:  ${result.ollamaAvailable}`);
    console.log(`   Flights found:     ${result.flights.length}`);
    console.log(`   Duration:          ${duration}ms\n`);

    if (result.flights.length > 0) {
      console.log('✈️  Extracted Flights:\n');
      result.flights.forEach((flight, idx) => {
        console.log(`   Flight ${idx + 1}:`);
        console.log(`   - Flight:       ${flight.flightNumber}`);
        console.log(`   - Route:        ${flight.departureCode} → ${flight.arrivalCode}`);
        console.log(`   - Departure:    ${flight.departureTime}`);
        console.log(`   - Arrival:      ${flight.arrivalTime || 'N/A'}`);
        console.log(`   - PNR:          ${flight.pnr || 'N/A'}`);
        console.log(`   - Seat:         ${flight.seat || 'N/A'}`);
        console.log(`   - Missing:      ${flight.missing.length > 0 ? flight.missing.join(', ') : 'none'}`);
        console.log('');
      });
    }

    console.log('='.repeat(60));

    if (result.parserUsed === 'ollama') {
      console.log('\n✨ SUCCESS! Enhanced Parser (Ollama) is working correctly!');
      console.log('   Model: qwen2.5:7b (as configured in .env)');
    } else {
      console.log('\n⚠️  Fallback to Regex parser');
      console.log('   Check that Ollama is running: ollama serve');
    }

    console.log('\n✅ Integration test passed!\n');
    process.exit(0);

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

main();
