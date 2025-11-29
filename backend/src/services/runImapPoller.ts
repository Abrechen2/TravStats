import { pollImapAndImport } from './imapPoller';
import dotenv from 'dotenv';
import { getSystemSettings } from './systemSettings';

dotenv.config();

async function poll() {
  const { emailImport } = await getSystemSettings();
  const pollInterval = emailImport.imap.pollIntervalMinutes;

  if (!emailImport.enabled || !emailImport.imap.enabled) {
    console.log('❌ IMAP import is disabled in the admin settings.');
    process.exit(0);
  }

  if (!emailImport.imap.user || !emailImport.imap.password) {
    console.error('❌ IMAP login data is missing. Please configure it in the admin settings.');
    process.exit(1);
  }

  if (!emailImport.imap.defaultUserId) {
    console.error('❌ A default user must be selected in the admin settings.');
    process.exit(1);
  }

  console.log('🚀 Starting IMAP Email Import Service');
  console.log(`📧 IMAP Host: ${emailImport.imap.host}:${emailImport.imap.port}`);
  console.log(`👤 IMAP User: ${emailImport.imap.user}`);
  console.log(`⏱️  Poll Interval: ${pollInterval} minutes`);
  console.log(`🆔 Default User ID: ${emailImport.imap.defaultUserId}`);
  console.log('');

  let iteration = 0;

  while (true) {
    iteration++;
    const timestamp = new Date().toISOString();

    try {
      console.log(`[${timestamp}] 🔍 Poll #${iteration}: Checking for new emails...`);
      await pollImapAndImport(
        {
          host: emailImport.imap.host,
          port: emailImport.imap.port,
          secure: emailImport.imap.secure,
          user: emailImport.imap.user,
          password: emailImport.imap.password,
          mailbox: emailImport.imap.mailbox,
          allowedSenders: emailImport.imap.allowedSenders,
          subjectKeywords: emailImport.imap.subjectKeywords,
        },
        emailImport.imap.defaultUserId
      );
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
