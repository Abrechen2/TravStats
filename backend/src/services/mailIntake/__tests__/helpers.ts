import type { MailFetcher, MailSession, MailboxConnection } from "../mailFetcher";
import { MailIntakeError, type SourceErrorKind } from "../errors";

export interface FakeMail {
  uid: number;
  raw: Buffer;
  /** Overrides the size the server reports (for the too-large path). */
  size?: number;
}

export function buildMail(opts: {
  messageId?: string | null;
  from?: string;
  to?: string;
  deliveredTo?: string;
  subject?: string;
  authResults?: string;
  body?: string;
  date?: string;
}): Buffer {
  const lines = [
    ...(opts.authResults ? [`Authentication-Results: ${opts.authResults}`] : []),
    ...(opts.deliveredTo ? [`Delivered-To: ${opts.deliveredTo}`] : []),
    `From: ${opts.from ?? "Airline <noreply@airline.example>"}`,
    `To: ${opts.to ?? "traveller@example.org"}`,
    `Subject: ${opts.subject ?? "Your booking confirmation"}`,
    `Date: ${opts.date ?? "Mon, 02 Nov 2026 09:00:00 +0000"}`,
    ...(opts.messageId === null ? [] : [`Message-ID: ${opts.messageId ?? "<m1@airline.example>"}`]),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    opts.body ?? "Flight LH 400 from FRA to JFK on 12 Nov 2026.",
    "",
  ];
  return Buffer.from(lines.join("\r\n"), "utf8");
}

/**
 * A mailbox in memory that behaves like the folder imapflow opens: UIDs
 * ascend, `listNew` answers only what is above `afterUid`, marking records
 * flags and removes nothing. `failWith` makes the connection fail the way a
 * real server's refusal does.
 */
export class FakeMailbox implements MailFetcher {
  mails: FakeMail[] = [];
  uidValidity = "1000";
  flagged = new Set<number>();
  connections: MailboxConnection[] = [];
  failWith: SourceErrorKind | null = null;
  refuseFlags = false;

  add(mail: FakeMail): void {
    this.mails.push(mail);
  }

  async withFolder<T>(
    connection: MailboxConnection,
    run: (session: MailSession) => Promise<T>
  ): Promise<T> {
    this.connections.push(connection);
    if (this.failWith) throw new MailIntakeError(this.failWith);
    const box = this;
    const session: MailSession = {
      uidValidity: box.uidValidity,
      async listNew(afterUid) {
        return box.mails
          .filter((m) => m.uid > afterUid)
          .map((m) => ({ uid: m.uid, size: m.size ?? m.raw.length }))
          .sort((a, b) => a.uid - b.uid);
      },
      async fetchSource(uid) {
        const mail = box.mails.find((m) => m.uid === uid);
        return mail ? { raw: mail.raw, internalDate: new Date("2026-11-02T09:01:00Z") } : null;
      },
      async markProcessed(uid) {
        if (box.refuseFlags) return false;
        box.flagged.add(uid);
        return true;
      },
    };
    return run(session);
  }

  async watch(): Promise<void> {
    return undefined;
  }
}
