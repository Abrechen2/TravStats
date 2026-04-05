/**
 * Test a parser template against all MSG files in test-samples/emails/
 * Run: cd backend && npx tsx ../scripts/test-template.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { extractEmailFromFile } from '../backend/src/services/emailExtractor';

const ROOT = path.join(__dirname, '..');

// Template patterns (from DB for template 8841fff0)
const PATTERNS: Record<string, string> = {
  pnr: "Lufthansa Buchungscode:\\s*([A-Z0-9]{5,8})",
  arrivalCode: "<https://images\\.booking\\.lufthansa\\.com/destinations/\\s*([A-Z]{3})",
  flightNumber: "<https://images\\.booking\\.lufthansa\\.com/Icons/icon_lufthansa\\.jpg>\\s*([A-Z0-9 ]{4,8})",
  departureCode: "M\u00fcnchen Munich[^(]*\\(([A-Z]{3})\\)",
};

function testPattern(text: string, pattern: string): string | null {
  try {
    const re = new RegExp(pattern);
    const match = re.exec(text);
    return match ? match[1].trim() : null;
  } catch (e) {
    return `ERROR: ${(e as Error).message}`;
  }
}

const emailsDir = path.join(ROOT, 'test-samples', 'emails');
const files = fs.readdirSync(emailsDir)
  .filter(f => path.extname(f).toLowerCase() === '.msg')
  .sort();

console.log(`Testing ${files.length} MSG files against template patterns\n`);
console.log('='.repeat(80));

let totalMatches = 0;
let totalFields = 0;

for (const file of files) {
  const buf = fs.readFileSync(path.join(emailsDir, file));
  let extracted: { text?: string; subject?: string };
  try {
    extracted = extractEmailFromFile(buf, file);
  } catch (e) {
    console.log(`\n[SKIP] ${file}`);
    console.log(`  Error: ${(e as Error).message}`);
    continue;
  }

  // Build fullText with subject header (same as training upload)
  const subject = extracted.subject ?? '';
  const body = extracted.text ?? '';
  const fullText = `Subject: ${subject}\n\n${body}`.replace(/\0/g, '');

  console.log(`\n[FILE] ${file}`);
  console.log(`  Subject: ${subject.substring(0, 80)}`);

  let fileMatches = 0;
  const results: Record<string, string | null> = {};

  for (const [field, pattern] of Object.entries(PATTERNS)) {
    const value = testPattern(fullText, pattern);
    results[field] = value;
    totalFields++;
    if (value && !value.startsWith('ERROR')) {
      fileMatches++;
      totalMatches++;
    }
  }

  const icon = fileMatches === Object.keys(PATTERNS).length ? 'PASS' :
               fileMatches > 0 ? 'PARTIAL' : 'FAIL';
  console.log(`  [${icon}] ${fileMatches}/${Object.keys(PATTERNS).length} fields matched`);
  for (const [field, value] of Object.entries(results)) {
    const status = value && !value.startsWith('ERROR') ? 'OK' : value ? 'ERR' : '--';
    console.log(`    [${status}] ${field}: ${value ?? 'no match'}`);
  }
}

console.log('\n' + '='.repeat(80));
const fileCount = files.length;
console.log(`SUMMARY: ${totalMatches}/${totalFields} field matches across ${fileCount} files`);
