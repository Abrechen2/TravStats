import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { prisma } from '../db';
import { parseBookingEmail } from './bookingParser';
import { v4 as uuidv4 } from 'uuid';

interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox?: string;
  allowedSenders?: string[];
  subjectKeywords?: string[];
}

export async function pollImapAndImport(config: ImapConfig, defaultUserId?: string) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
    logger: {
      debug: (msg: any) => console.log('[IMAP][debug]', msg),
      info: (msg: any) => console.log('[IMAP][info]', msg),
      warn: (msg: any) => console.warn('[IMAP][warn]', msg),
      error: (msg: any) => console.error('[IMAP][error]', msg),
    },
  });

  const mailbox = config.mailbox || 'INBOX';

  try {
    console.log(`Connecting to IMAP server: ${config.host}:${config.port} (secure: ${config.secure})`);
    await client.connect();
    console.log('IMAP connection established');

    console.log(`Opening mailbox: ${mailbox}`);
    await client.mailboxOpen(mailbox);
    console.log('Mailbox opened successfully');

    const allowedSenders = (config.allowedSenders || []).map((s) => s.toLowerCase().trim()).filter(Boolean);
    const subjectKeywords = (config.subjectKeywords || []).map((s) => s.toLowerCase().trim()).filter(Boolean);

    // Narrow search to unseen messages, optionally filtered by sender to reduce load.
    let targetUids: number[] = [];
    if (allowedSenders.length > 0) {
      for (const sender of allowedSenders) {
        const matches = await client.search({ seen: false, from: sender });
        if (matches && matches.length > 0) {
          targetUids.push(...matches);
        }
      }
    } else {
      const searchResult = await client.search({ seen: false });
      targetUids = Array.isArray(searchResult) ? searchResult : [];
    }

    const deduped = Array.from(new Set(targetUids)).sort((a, b) => a - b);
    console.log(`Found ${deduped.length} unread email(s)`);

    if (deduped.length === 0) {
      console.log('No new emails to process');
      return;
    }

    console.log(`Processing ${deduped.length} email(s)...`);
    let processed = 0;

    for await (const msg of client.fetch(deduped, { envelope: true, source: true, flags: true })) {
      processed++;
      const parsed = await simpleParser(msg.source!);
      const subject = parsed.subject || '';
      const from = (parsed.from as any)?.text || '';
      const to = (parsed.to as any)?.text || '';
      const text = parsed.text || '';
      const html = parsed.html ? String(parsed.html) : '';

      // Filter to specific senders/subjects (e.g., Lufthansa bookings)
      const fromLower = from.toLowerCase();
      if (allowedSenders.length > 0) {
        const isAllowed = allowedSenders.some((domain) => fromLower.includes(domain));
        if (!isAllowed) {
          continue;
        }
      }
      if (subjectKeywords.length > 0) {
        const subjLower = subject.toLowerCase();
        const hasKeyword = subjectKeywords.some((keyword) => subjLower.includes(keyword));
        if (!hasKeyword) {
          continue;
        }
      }

      const parsedData = parseBookingEmail(subject, text, html);

      console.log(`   Email #${processed}: "${subject}" from ${from}`);
      console.log(
        `      Parsed: Flight ${parsedData.flightNumber || '?'} (${parsedData.departureCode || '?'} -> ${parsedData.arrivalCode || '?'})`,
      );

      await prisma.importedFlight.create({
        data: {
          id: uuidv4(),
          userId: defaultUserId || '',
          status: 'pending_review',
          subject,
          fromAddress: from,
          toAddress: to,
          raw: text.slice(0, 8000),
          parsed: parsedData as any,
        },
      });

      console.log('      Imported to database (pending review)');
      await client.messageFlagsAdd(msg.uid, ['\\Seen']);
    }

    console.log(`Successfully processed ${processed} email(s)`);
  } catch (error: any) {
    console.error('IMAP polling failed:', error?.message || error);
    if (error?.authenticationFailed) {
      console.error('Authentication failed - check username/password');
    }
    throw error;
  } finally {
    try {
      await client.logout();
    } catch (logoutError: any) {
      console.warn('Failed to close IMAP connection cleanly:', logoutError?.message || logoutError);
    }
  }
}
