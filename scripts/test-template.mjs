/**
 * Test a parser template against all MSG files in test-samples/emails/
 * Usage: node scripts/test-template.mjs
 */
import { readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Template patterns (copy from DB — update if template changes)
const PATTERNS = {
  pnr: "Lufthansa Buchungscode:\\s*([A-Z0-9]{5,8})",
  arrivalCode: "<https://images\\.booking\\.lufthansa\\.com/destinations/\\s*([A-Z]{3})",
  flightNumber: "<https://images\\.booking\\.lufthansa\\.com/Icons/icon_lufthansa\\.jpg>\\s*([A-Z0-9 ]{4,8})",
  departureCode: "12:00 Uhr \tM\u00c3\u00bcnchen Munich\\s*([A-Z]{3})",
};

/**
 * Parse MSG file text using @kenjiuno/msgreader (CommonJS)
 */
async function extractMsgText(buffer, filename) {
  // Dynamic import for CJS module
  const { default: MsgReader } = await import('../backend/node_modules/@kenjiuno/msgreader/lib/MsgReader.js');
  const reader = new MsgReader(buffer);
  const msg = reader.getFileData();
  const body = msg.body || msg.bodyHtml || '';
  // Strip HTML tags if body is HTML
  const text = body.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const subject = msg.subject || '';
  return `Subject: ${subject}\n\n${text}`;
}

function testPattern(text, fieldName, pattern) {
  try {
    const re = new RegExp(pattern);
    const match = re.exec(text);
    return match ? match[1].trim() : null;
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

const emailsDir = join(ROOT, 'test-samples', 'emails');
const files = readdirSync(emailsDir).filter(f => extname(f).toLowerCase() === '.msg');

console.log(`Testing ${files.length} MSG files against template patterns\n`);
console.log('='.repeat(80));

let totalMatches = 0;
let totalFields = 0;

for (const file of files.sort()) {
  const buf = readFileSync(join(emailsDir, file));
  let text;
  try {
    text = await extractMsgText(buf, file);
  } catch (e) {
    console.log(`\n[SKIP] ${file}`);
    console.log(`  Could not extract text: ${e.message}`);
    continue;
  }

  console.log(`\n[FILE] ${file}`);
  const results = {};
  let fileMatches = 0;

  for (const [field, pattern] of Object.entries(PATTERNS)) {
    const value = testPattern(text, field, pattern);
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
console.log(`SUMMARY: ${totalMatches}/${totalFields} field matches across ${files.length} files`);
