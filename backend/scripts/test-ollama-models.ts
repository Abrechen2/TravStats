/**
 * Test script to compare different Ollama models for flight email parsing
 *
 * Usage:
 *   npm run test:ollama-models
 */

import axios from 'axios';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

const TEST_EMAILS = [
  {
    name: 'Lufthansa Round Trip',
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
    expected: 2, // Number of flights
    expectedFields: ['LH103', 'LH442', 'MUC', 'LUX', '9RFAA7', '26F']
  },
  {
    name: 'Ryanair One Way',
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
    expected: 1,
    expectedFields: ['FR8234', 'BER', 'STN', 'ABC123', '15A']
  },
  {
    name: 'Multi-Leg Journey',
    subject: 'Ihre Reise Frankfurt - Bangkok',
    text: `Buchungsbestätigung PNR: XYZ789

1. Flug: LH712
   Frankfurt (FRA) → Bangkok (BKK)
   15.01.2026, 22:10 → 16.01.2026, 14:35

2. Flug: TG417
   Bangkok (BKK) → Phuket (HKT)
   16.01.2026, 18:30 → 19:50

Gesamtpreis: 1.249,00 EUR`,
    expected: 2,
    expectedFields: ['LH712', 'TG417', 'FRA', 'BKK', 'HKT', 'XYZ789']
  }
];

const MODELS_TO_TEST = [
  'llama3.2:3b',
  'qwen2.5:7b',
  'mistral:7b',
  'gemma2:9b',
];

interface TestResult {
  model: string;
  email: string;
  duration: number;
  success: boolean;
  flightsFound: number;
  fieldsFound: number;
  accuracy: number;
  error?: string;
}

async function testModel(model: string, email: typeof TEST_EMAILS[0]): Promise<TestResult> {
  console.log(`\n🧪 Testing ${model} on "${email.name}"...`);

  const prompt = `Extract ALL flights from this email. Return ONLY a JSON array.

SUBJECT: ${email.subject}

BODY: ${email.text}

Output format:
[
  {
    "flightNumber": "LH103",
    "departureCode": "MUC",
    "arrivalCode": "LUX",
    "departureTime": "2025-11-18T11:00",
    "pnr": "9RFAA7",
    "seat": "26F"
  }
]

JSON:`;

  const startTime = Date.now();

  try {
    const response = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      {
        model,
        prompt,
        stream: false,
        format: 'json',
        options: {
          temperature: 0.05,
          top_p: 0.9,
        },
      },
      {
        timeout: 120000, // 2 minutes
      }
    );

    const duration = Date.now() - startTime;

    // Parse response
    let jsonText = response.data.response.trim();
    if (jsonText.includes('```')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }

    // Extract JSON array
    const jsonStart = jsonText.indexOf('[');
    const jsonEnd = jsonText.lastIndexOf(']') + 1;
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      jsonText = jsonText.substring(jsonStart, jsonEnd);
    }

    const flights = JSON.parse(jsonText);
    const flightsArray = Array.isArray(flights) ? flights : [flights];

    // Count extracted fields
    let fieldsFound = 0;
    const extractedText = JSON.stringify(flights).toLowerCase();

    for (const expectedField of email.expectedFields) {
      if (extractedText.includes(expectedField.toLowerCase())) {
        fieldsFound++;
      }
    }

    const accuracy = (fieldsFound / email.expectedFields.length) * 100;

    const result: TestResult = {
      model,
      email: email.name,
      duration,
      success: true,
      flightsFound: flightsArray.length,
      fieldsFound,
      accuracy,
    };

    console.log(`  ✅ Success in ${duration}ms`);
    console.log(`  📊 Flights: ${flightsArray.length}/${email.expected}`);
    console.log(`  📈 Accuracy: ${accuracy.toFixed(1)}%`);

    return result;

  } catch (error: any) {
    const duration = Date.now() - startTime;

    console.log(`  ❌ Failed: ${error.message}`);

    return {
      model,
      email: email.name,
      duration,
      success: false,
      flightsFound: 0,
      fieldsFound: 0,
      accuracy: 0,
      error: error.message,
    };
  }
}

async function checkModelAvailability(model: string): Promise<boolean> {
  try {
    const response = await axios.get(`${OLLAMA_URL}/api/tags`);
    const models = response.data.models || [];
    return models.some((m: any) => m.name === model);
  } catch {
    return false;
  }
}

async function pullModel(model: string): Promise<void> {
  console.log(`📥 Downloading ${model}... (this may take a few minutes)`);

  try {
    await axios.post(
      `${OLLAMA_URL}/api/pull`,
      { name: model, stream: false },
      { timeout: 600000 } // 10 minutes
    );
    console.log(`✅ ${model} downloaded successfully`);
  } catch (error: any) {
    console.error(`❌ Failed to download ${model}: ${error.message}`);
    throw error;
  }
}

async function main() {
  console.log('🚀 TravStats Ollama Model Comparison Tool\n');
  console.log('='.repeat(60));

  // Check Ollama connection
  try {
    await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 });
    console.log('✅ Connected to Ollama at', OLLAMA_URL);
  } catch {
    console.error('❌ Cannot connect to Ollama. Is it running?');
    console.error('   Start with: ollama serve');
    process.exit(1);
  }

  // Check and download models
  console.log('\n📦 Checking models...');
  for (const model of MODELS_TO_TEST) {
    const available = await checkModelAvailability(model);
    if (!available) {
      console.log(`   ⚠️  ${model} not found locally`);
      const shouldPull = process.argv.includes('--download-missing');

      if (shouldPull) {
        await pullModel(model);
      } else {
        console.log(`      Run with --download-missing to download automatically`);
        console.log(`      Or manually: ollama pull ${model}`);
      }
    } else {
      console.log(`   ✅ ${model} available`);
    }
  }

  // Run tests
  console.log('\n🧪 Running tests...');
  console.log('='.repeat(60));

  const results: TestResult[] = [];

  for (const model of MODELS_TO_TEST) {
    const available = await checkModelAvailability(model);
    if (!available) {
      console.log(`\n⏭️  Skipping ${model} (not available)`);
      continue;
    }

    console.log(`\n📊 Testing model: ${model}`);
    console.log('-'.repeat(60));

    for (const email of TEST_EMAILS) {
      const result = await testModel(model, email);
      results.push(result);

      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Print summary
  console.log('\n\n📊 SUMMARY');
  console.log('='.repeat(60));

  // Group by model
  const modelGroups = results.reduce((acc, result) => {
    if (!acc[result.model]) acc[result.model] = [];
    acc[result.model].push(result);
    return acc;
  }, {} as Record<string, TestResult[]>);

  for (const [model, modelResults] of Object.entries(modelGroups)) {
    console.log(`\n${model}:`);

    const avgDuration = modelResults.reduce((sum, r) => sum + r.duration, 0) / modelResults.length;
    const avgAccuracy = modelResults.reduce((sum, r) => sum + r.accuracy, 0) / modelResults.length;
    const successRate = (modelResults.filter(r => r.success).length / modelResults.length) * 100;

    console.log(`  ⏱️  Avg Duration: ${avgDuration.toFixed(0)}ms`);
    console.log(`  📈 Avg Accuracy: ${avgAccuracy.toFixed(1)}%`);
    console.log(`  ✅ Success Rate: ${successRate.toFixed(1)}%`);

    modelResults.forEach(result => {
      const icon = result.success ? '✅' : '❌';
      console.log(`     ${icon} ${result.email}: ${result.accuracy.toFixed(0)}% (${result.duration}ms)`);
    });
  }

  // Recommendations
  console.log('\n\n🎯 RECOMMENDATIONS');
  console.log('='.repeat(60));

  const modelScores = Object.entries(modelGroups).map(([model, results]) => {
    const avgAccuracy = results.reduce((sum, r) => sum + r.accuracy, 0) / results.length;
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    const score = avgAccuracy - (avgDuration / 100); // Balance accuracy vs speed

    return { model, avgAccuracy, avgDuration, score };
  });

  modelScores.sort((a, b) => b.score - a.score);

  console.log('\nBest models for TravStats:');
  modelScores.forEach((entry, index) => {
    const medal = ['🥇', '🥈', '🥉'][index] || '  ';
    console.log(`${medal} ${entry.model}`);
    console.log(`    Accuracy: ${entry.avgAccuracy.toFixed(1)}%`);
    console.log(`    Speed: ${entry.avgDuration.toFixed(0)}ms`);
    console.log(`    Score: ${entry.score.toFixed(1)}`);
  });

  console.log('\n💡 To use the best model, add to your .env:');
  console.log(`   OLLAMA_MODEL=${modelScores[0].model}`);

  console.log('\n✨ Done!\n');
}

// Run
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
