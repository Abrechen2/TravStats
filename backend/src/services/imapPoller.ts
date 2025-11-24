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
    logger: false as any,
  });

  await client.connect();
  const mailbox = config.mailbox || 'INBOX';
  await client.mailboxOpen(mailbox);

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
  if (!deduped || deduped.length === 0) {
    await client.logout();
    return;
  }

  for await (const msg of client.fetch(deduped, { envelope: true, source: true, flags: true })) {
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

    await client.messageFlagsAdd(msg.uid, ['\\Seen']);
  }

  await client.logout();
}
