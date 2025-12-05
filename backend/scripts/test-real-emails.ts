/**
 * Test script for Enhanced LLM Parser with real sample emails
 *
 * Usage:
 *   npm run test:parser:real
 */

import { parseEmailWithLLM, isOllamaAvailable, ensureModelAvailable } from '../src/services/llmParser.enhanced';
import MsgReader from '@kenjiuno/msgreader';
import fs from 'fs';
import path from 'path';

const SAMPLE_EMAILS_DIR = path.join(process.cwd(), '..', 'Sample Emails');

interface EmailFile {
  filename: string;
  path: string;
}

function sanitizeForPostgres(str: string | undefined): string {
  if (!str) return '';
  return str.replace(/\0/g, '').replace(/\uFFFD/g, '');
}

function printSeparator(char = '=', length = 80) {
  console.log(char.repeat(length));
}

function printFlight(flight: any, index: number, total: number) {
  console.log(`\n   ✈️  Flight ${index + 1}/${total}:`);
  console.log(`      Flight:         ${flight.flightNumber || '❌ MISSING'}`);
  console.log(`      Route:          ${flight.departureCode || '???'} → ${flight.arrivalCode || '???'}`);
  console.log(`      Departure:      ${flight.departureTime || '❌ MISSING'}`);
  console.log(`      Arrival:        ${flight.arrivalTime || 'N/A'}`);
  console.log(`      PNR:            ${flight.pnr || 'N/A'}`);
  console.log(`      Seat:           ${flight.seat || 'N/A'}`);

  if (flight.price && flight.currency) {
    console.log(`      Price:          ${flight.price} ${flight.currency}`);
  }

  if (flight.missing && flight.missing.length > 0) {
    console.log(`      ⚠️  Missing:     ${flight.missing.join(', ')}`);
  }
}

async function readMsgFile(filePath: string): Promise<{ subject: string; text: string; html?: string }> {
  const fileBuffer = fs.readFileSync(filePath);
  const msgReader = new MsgReader(fileBuffer);
  const fileData = msgReader.getFileData();

  const subject = sanitizeForPostgres(fileData.subject);
  const body = sanitizeForPostgres(fileData.body);
  const bodyHTML = fileData.bodyHTML ? sanitizeForPostgres(fileData.bodyHTML) : undefined;

  return {
    subject,
    text: body,
    html: bodyHTML,
  };
}

function getEmailFiles(): EmailFile[] {
  if (!fs.existsSync(SAMPLE_EMAILS_DIR)) {
    console.error(`❌ Sample Emails directory not found: ${SAMPLE_EMAILS_DIR}`);
    return [];
  }

  const files = fs.readdirSync(SAMPLE_EMAILS_DIR);
  return files
    .filter(file => file.endsWith('.msg'))
    .map(file => ({
      filename: file,
      path: path.join(SAMPLE_EMAILS_DIR, file),
    }));
}

async function testEmailFile(emailFile: EmailFile, testNumber: number) {
  console.log(`\n${testNumber}. Testing: ${emailFile.filename}`);
  printSeparator('-', 80);

  try {
    // Read .msg file
    const email = await readMsgFile(emailFile.path);
    console.log(`   Subject: "${email.subject}"`);
    console.log(`   Text length: ${email.text.length} characters`);
    console.log(`   HTML: ${email.html ? 'Yes' : 'No'}\n`);

    // Parse with LLM
    const startTime = Date.now();
    const results = await parseEmailWithLLM(email.subject, email.text, email.html);
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
      filename: emailFile.filename,
      success: true,
      flightsFound: results.length,
      duration,
      results,
    };

  } catch (error: any) {
    console.log(`   ❌ Test failed: ${error.message}`);

    return {
      filename: emailFile.filename,
      success: false,
      flightsFound: 0,
      duration: 0,
      error: error.message,
    };
  }
}

async function main() {
  console.log('\n🚀 TravStats Enhanced Parser - Real Email Test\n');
  printSeparator();

  // Check Ollama
  console.log('\n📡 Checking Ollama connection...');
  const available = await isOllamaAvailable();

  if (!available) {
    console.error('❌ Cannot connect to Ollama');
    console.error('   Make sure Ollama is running: ollama serve');
    process.exit(1);
  }

  console.log('✅ Connected to Ollama');

  // Ensure model
  console.log('\n🔍 Checking model availability...');
  const modelReady = await ensureModelAvailable();

  if (!modelReady) {
    console.error('❌ Model not available');
    console.error('   Current model: ' + (process.env.OLLAMA_MODEL || 'llama3.2:3b'));
    process.exit(1);
  }

  const currentModel = process.env.OLLAMA_MODEL || 'llama3.2:3b';
  console.log('✅ Model ready: ' + currentModel);

  // Get sample emails
  console.log('\n📧 Loading sample emails...');
  const emailFiles = getEmailFiles();

  if (emailFiles.length === 0) {
    console.error('❌ No .msg files found in Sample Emails directory');
    process.exit(1);
  }

  console.log(`✅ Found ${emailFiles.length} email(s):`);
  emailFiles.forEach((file, idx) => {
    console.log(`   ${idx + 1}. ${file.filename}`);
  });

  // Run tests
  console.log('\n🧪 Running parser tests...');
  printSeparator();

  const results = [];
  for (let i = 0; i < emailFiles.length; i++) {
    const result = await testEmailFile(emailFiles[i], i + 1);
    results.push(result);

    // Small delay between tests
    if (i < emailFiles.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log('\n\n📊 SUMMARY');
  printSeparator();

  const totalFlights = results.reduce((sum, r) => sum + r.flightsFound, 0);
  const avgDuration = results.filter(r => r.success).reduce((sum, r) => sum + r.duration, 0) / results.filter(r => r.success).length;
  const successRate = (results.filter(r => r.success).length / results.length) * 100;

  console.log(`\n   Model used:           ${currentModel}`);
  console.log(`   Total emails tested:  ${results.length}`);
  console.log(`   Total flights found:  ${totalFlights}`);
  console.log(`   Success rate:         ${successRate.toFixed(1)}%`);
  console.log(`   Average duration:     ${avgDuration.toFixed(0)}ms`);

  console.log('\n   Results per email:');
  results.forEach((result) => {
    const icon = result.success ? '✅' : '❌';
    console.log(`   ${icon} ${result.filename}: ${result.flightsFound} flights (${result.duration}ms)`);
  });

  // Show all extracted flights
  console.log('\n\n🎯 ALL EXTRACTED FLIGHTS');
  printSeparator();

  results.forEach((result, idx) => {
    if (result.success && result.results && result.results.length > 0) {
      console.log(`\n${result.filename}:`);
      result.results.forEach((flight: any, fIdx: number) => {
        const route = `${flight.departureCode} → ${flight.arrivalCode}`;
        const flightNum = flight.flightNumber || '???';
        const date = flight.departureTime ? flight.departureTime.split('T')[0] : '???';
        console.log(`   ${fIdx + 1}. ${flightNum}: ${route} (${date})`);
      });
    }
  });

  // Tips
  console.log('\n\n💡 RECOMMENDATIONS');
  printSeparator();

  if (avgDuration > 3000) {
    console.log('\n   ⚡ Model is slow (>3s per email)');
    console.log('      Consider using llama3.2:3b for faster processing');
  } else if (avgDuration < 1000) {
    console.log('\n   ⚡ Very fast processing! (<1s per email)');
  }

  if (totalFlights < emailFiles.length * 2) {
    console.log('\n   🎯 Some emails may have multiple flights not detected');
    console.log('      Consider trying a larger model for better accuracy:');
    console.log('      • qwen2.5:7b - Best for structured data');
    console.log('      • mistral:7b - Excellent multilingual support');
  }

  if (totalFlights >= emailFiles.length * 2) {
    console.log('\n   ✨ Excellent detection rate!');
    console.log('      The parser is working well with this model.');
  }

  console.log('\n✨ Done!\n');
}

// Run
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
