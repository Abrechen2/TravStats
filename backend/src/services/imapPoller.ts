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
  await client.selectMailbox('INBOX');

  for await (const msg of client.fetch('1:*', { envelope: true, source: true, flags: true })) {
    if (msg.flags.has('\\Seen')) continue; // skip seen

    const parsed = await simpleParser(msg.source!);
    const subject = parsed.subject || '';
    const from = parsed.from?.text || '';
    const to = parsed.to?.text || '';
    const text = parsed.text || '';
    const html = parsed.html ? String(parsed.html) : '';

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
