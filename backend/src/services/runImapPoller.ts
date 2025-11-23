import { pollImapAndImport } from './imapPoller';
import dotenv from 'dotenv';

dotenv.config();

const parseList = (value?: string) =>
  (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const defaultAllowedSenders = ['@lufthansa.com', '@dlh.de', '@mail.lufthansa.com'];
const defaultSubjectKeywords = ['lufthansa', 'buchungsbestaetigung', 'booking', 'etix', 'eticket'];

const config = {
  host: process.env.IMAP_HOST || 'imap.gmail.com',
  port: Number(process.env.IMAP_PORT) || 993,
  secure: process.env.IMAP_SECURE === 'true',
  user: process.env.IMAP_USER || '',
  password: process.env.IMAP_PASSWORD || '',
  mailbox: process.env.IMAP_MAILBOX || 'INBOX',
  allowedSenders: (() => {
    const parsed = parseList(process.env.IMAP_ALLOWED_SENDERS);
    return parsed.length > 0 ? parsed : defaultAllowedSenders;
  })(),
  subjectKeywords: (() => {
    const parsed = parseList(process.env.IMAP_SUBJECT_KEYWORDS);
    return parsed.length > 0 ? parsed : defaultSubjectKeywords;
  })(),
};

const defaultUserId = process.env.IMAP_DEFAULT_USER_ID;
const pollInterval = Number(process.env.IMAP_POLL_INTERVAL) || 5;

async function poll() {
  if (process.env.IMAP_ENABLED !== 'true') {
    console.log('❌ IMAP is disabled. Set IMAP_ENABLED=true in .env');
    process.exit(0);
  }

  if (!config.user || !config.password) {
    console.error('❌ IMAP_USER and IMAP_PASSWORD must be set in .env');
    process.exit(1);
  }

  if (!defaultUserId) {
    console.error('❌ IMAP_DEFAULT_USER_ID must be set in .env');
    process.exit(1);
  }

  console.log('🚀 Starting IMAP Email Import Service');
  console.log(`📧 IMAP Host: ${config.host}:${config.port}`);
  console.log(`👤 IMAP User: ${config.user}`);
  console.log(`⏱️  Poll Interval: ${pollInterval} minutes`);
  console.log(`🆔 Default User ID: ${defaultUserId}`);
  console.log('');

  let iteration = 0;

  while (true) {
    iteration++;
    const timestamp = new Date().toISOString();

    try {
      console.log(`[${timestamp}] 🔍 Poll #${iteration}: Checking for new emails...`);
      await pollImapAndImport(config, defaultUserId);
      console.log(`[${timestamp}] ✅ Poll #${iteration} completed successfully`);
    } catch (error: any) {
      console.error(`[${timestamp}] ❌ Poll #${iteration} failed:`, error.message);
      if (error.stack) {
        console.error(error.stack);
      }
    }

    console.log(`⏳ Waiting ${pollInterval} minutes until next poll...\n`);

    // Wait for next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval * 60 * 1000));
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down IMAP poller...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n👋 Shutting down IMAP poller...');
  process.exit(0);
});

poll().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
