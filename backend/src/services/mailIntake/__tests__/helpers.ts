import {
  processedFlags,
  type MailFetcher,
  type MailSession,
  type MailboxConnection,
} from "../mailFetcher";
import type { HeaderInfo } from "../prefilter";
import { MailIntakeError, type SourceErrorKind } from "../errors";

export interface FakeMail {
  uid: number;
  raw: Buffer;
  /** Overrides the size the server reports (for the too-large path). */
  size?: number;
  /** INTERNALDATE, for UID SEARCH SINCE. */
  internalDate?: Date;
}

/** Reads the header block of a raw mail the way the server's ENVELOPE would answer. */
export function headersOf(uid: number, raw: Buffer): HeaderInfo {
  const head = raw.toString("utf8").split("\r\n\r\n")[0];
  const field = (name: string): string | null =>
    new RegExp(`^${name}:\\s*(.*)$`, "im").exec(head)?.[1]?.trim() ?? null;
  const from = field("From");
  const address = from ? (/<([^>]+)>/.exec(from)?.[1] ?? from) : null;
  const date = field("Date");
  return {
    uid,
    from: address ? address.toLowerCase() : null,
    subject: field("Subject"),
    date: date ? new Date(date) : null,
    messageId: field("Message-ID"),
    hasListId: field("List-Id") !== null,
  };
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
  /** Raw header lines added at the top, as written upstream (e.g. a forged Sender). */
  extraHeaders?: string[];
  listId?: string;
}): Buffer {
  const lines = [
    ...(opts.extraHeaders ?? []),
    ...(opts.authResults ? [`Authentication-Results: ${opts.authResults}`] : []),
    ...(opts.deliveredTo ? [`Delivered-To: ${opts.deliveredTo}`] : []),
    `From: ${opts.from ?? "Airline <noreply@airline.example>"}`,
    `To: ${opts.to ?? "traveller@example.org"}`,
    `Subject: ${opts.subject ?? "Your booking confirmation"}`,
    ...(opts.listId ? [`List-Id: ${opts.listId}`] : []),
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
  /** PERMANENTFLAGS carries `\\*`. */
  supportsKeywords = true;
  /** Overrides UIDNEXT (default: highest UID + 1). */
  uidNext: number | null = null;
  /** Every UID whose body was downloaded, in order. */
  downloads: number[] = [];
  /** Every UID whose headers were fetched. */
  headerFetches: number[] = [];
  /** Flags set per UID. */
  flags = new Map<number, string[]>();

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
      uidNext: box.uidNext ?? Math.max(0, ...box.mails.map((m) => m.uid)) + 1,
      supportsKeywords: box.supportsKeywords,
      async searchUids({ since, before }) {
        return box.mails
          .filter((m) => {
            const at = m.internalDate ?? new Date("2026-11-02T09:01:00Z");
            return (!since || at >= since) && (!before || at < before);
          })
          .map((m) => m.uid)
          .sort((a, b) => a - b);
      },
      async fetchHeaders(uids) {
        box.headerFetches.push(...uids);
        const wanted = new Set(uids);
        return box.mails.filter((m) => wanted.has(m.uid)).map((m) => headersOf(m.uid, m.raw));
      },
      async listNew(afterUid) {
        return box.mails
          .filter((m) => m.uid > afterUid)
          .map((m) => ({ uid: m.uid, size: m.size ?? m.raw.length }))
          .sort((a, b) => a.uid - b.uid);
      },
      async fetchSource(uid, maxBytes) {
        const mail = box.mails.find((m) => m.uid === uid);
        if (!mail) return null;
        box.downloads.push(uid);
        // Like the real client: the cap is applied to the bytes, whatever the listing said.
        if (mail.raw.length > maxBytes) return { tooLarge: true as const };
        return { raw: mail.raw, internalDate: new Date("2026-11-02T09:01:00Z") };
      },
      async markProcessed(uid, { keepUnread }) {
        if (box.refuseFlags) return false;
        const set = processedFlags(keepUnread, box.supportsKeywords);
        if (set.length === 0) return false;
        box.flagged.add(uid);
        box.flags.set(uid, set);
        return true;
      },
    };
    return run(session);
  }

  async watch(_c?: unknown, _onNew?: () => void, _signal?: AbortSignal): Promise<void> {
    return undefined;
  }
}
