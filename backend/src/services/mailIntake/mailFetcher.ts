/**
 * The IMAP side of the mail intake, behind an interface so the pipeline is
 * tested without a server and the real client is tested against GreenMail
 * (`__tests__/imapFetcher.greenmail.test.ts`).
 *
 * Only the configured folder is ever opened. The rest of the mailbox is never
 * listed (spec §3 A), and nothing is deleted or moved: a processed mail gets
 * the keyword `$TravStats` and, unless the source keeps mails unread, `\Seen`
 * (decision 3). Headers are read through ENVELOPE and `BODY.PEEK[HEADER.FIELDS]`,
 * the body through `BODY.PEEK[]`: reading never sets `\Seen` by itself.
 */
import { ImapFlow } from "imapflow";

import logger from "../../utils/logger";
import { MailIntakeError, classifyImapError } from "./errors";
import type { HeaderInfo } from "./prefilter";

export const PROCESSED_KEYWORD = "$TravStats";

export type TlsMode = "tls" | "starttls" | "none";

export interface MailboxConnection {
  host: string;
  port: number;
  tlsMode: TlsMode;
  username: string;
  password: string;
  folder: string;
  /** Connect here instead of resolving `host` again (a checked, pinned address). */
  connectHost?: string;
}

export interface MailSession {
  /** UIDVALIDITY of the opened folder, as a decimal string. */
  readonly uidValidity: string;
  /** UIDNEXT of the opened folder: every mail there now has a UID below it. */
  readonly uidNext: number;
  /** PERMANENTFLAGS carries `\*`: the server keeps keywords such as `$TravStats`. */
  readonly supportsKeywords: boolean;
  /** UIDs of the mails received on/after `since` and before `before` (UID SEARCH); all when both are null. */
  searchUids(range: { since: Date | null; before: Date | null }): Promise<number[]>;
  /** From, Subject, Date, Message-ID and List-Id of `uids` — never a body part. */
  fetchHeaders(uids: number[]): Promise<HeaderInfo[]>;
  /** UIDs above `afterUid`, ascending, with their sizes. */
  listNew(afterUid: number): Promise<Array<{ uid: number; size: number }>>;
  /**
   * The raw mail, read with the cap enforced DURING the download: the size a
   * server reports in a listing is only a hint. Past `maxBytes` the download is
   * abandoned and `tooLarge` answers.
   */
  fetchSource(
    uid: number,
    maxBytes: number
  ): Promise<{ raw: Buffer; internalDate: Date | null } | { tooLarge: true } | null>;
  /**
   * Best effort: flags `$TravStats` (when the server keeps keywords) and `\Seen`
   * unless `keepUnread`. Returns false when nothing could be set; the UID cursor
   * and the Message-ID dedupe then keep the mail from being taken twice.
   */
  markProcessed(uid: number, options: { keepUnread: boolean }): Promise<boolean>;
}

export interface MailFetcher {
  withFolder<T>(
    connection: MailboxConnection,
    run: (session: MailSession) => Promise<T>
  ): Promise<T>;
  /**
   * Holds the folder open in IDLE and calls `onNew` when mail arrives, until
   * `signal` aborts. Resolves (or rejects) when the connection ends; the 5-minute
   * poll is the safety net either way.
   */
  watch(connection: MailboxConnection, onNew: () => void, signal: AbortSignal): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 60_000;

function clientFor(connection: MailboxConnection): ImapFlow {
  const client = new ImapFlow({
    host: connection.connectHost ?? connection.host,
    port: connection.port,
    // The certificate is checked against the name the user typed, also when the
    // socket goes to the address we resolved and checked ourselves.
    tls: { servername: connection.host } as unknown as ConstructorParameters<
      typeof ImapFlow
    >[0]["tls"],
    secure: connection.tlsMode === "tls",
    doSTARTTLS:
      connection.tlsMode === "starttls" ? true : connection.tlsMode === "none" ? false : undefined,
    auth: { user: connection.username, pass: connection.password },
    logger: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
  // imapflow emits 'error' for socket failures after connect; an unhandled one
  // would take the process down. The failing call has already rejected.
  client.on("error", (error: unknown) => {
    logger.warn({ operation: "mail_intake_imap_error", kind: classifyImapError(error) });
  });
  return client;
}

function toNumber(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value ?? 0);
}

/** `1,2,3,7,9,10` → `1:3,7,9:10`: a sequence set short enough for one command. */
export function uidSet(uids: number[]): string {
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const uid of sorted.slice(1).concat(Number.NaN)) {
    if (uid === prev + 1) {
      prev = uid;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}:${prev}`);
    start = uid;
    prev = uid;
  }
  return parts.join(",");
}

/** The flags a processed mail gets; empty when there is nothing the server would keep. */
export function processedFlags(keepUnread: boolean, supportsKeywords: boolean): string[] {
  return [...(keepUnread ? [] : ["\\Seen"]), ...(supportsKeywords ? [PROCESSED_KEYWORD] : [])];
}

function validDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(value as string | Date);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const imapFetcher: MailFetcher = {
  async withFolder(connection, run) {
    const client = clientFor(connection);
    try {
      await client.connect();
      const lock = await client.getMailboxLock(connection.folder).catch((error: unknown) => {
        throw new MailIntakeError(classifyImapError(error), "mailbox could not be opened");
      });
      try {
        const mailbox = client.mailbox;
        const supportsKeywords = mailbox ? !!mailbox.permanentFlags?.has("\\*") : false;
        const session: MailSession = {
          uidValidity: mailbox ? String(mailbox.uidValidity) : "0",
          uidNext: mailbox ? toNumber(mailbox.uidNext) : 1,
          supportsKeywords,
          async searchUids({ since, before }) {
            if (!mailbox || mailbox.exists === 0) return [];
            const query =
              since || before
                ? { ...(since ? { since } : {}), ...(before ? { before } : {}) }
                : { all: true };
            const found = await client.search(query, { uid: true });
            return (found || []).map(toNumber).sort((a, b) => a - b);
          },
          async fetchHeaders(uids) {
            if (uids.length === 0) return [];
            const rows = await client.fetchAll(
              uidSet(uids),
              { uid: true, envelope: true, headers: ["list-id"] },
              { uid: true }
            );
            return rows.map((row) => {
              const address = row.envelope?.from?.[0]?.address;
              return {
                uid: toNumber(row.uid),
                from: address ? address.trim().toLowerCase() : null,
                subject: row.envelope?.subject ?? null,
                date: validDate(row.envelope?.date),
                messageId: row.envelope?.messageId ?? null,
                hasListId: !!row.headers && /^list-id:/im.test(row.headers.toString("utf8")),
              };
            });
          },
          async listNew(afterUid) {
            if (!mailbox || mailbox.exists === 0) return [];
            const rows = await client.fetchAll(
              `${afterUid + 1}:*`,
              { uid: true, size: true },
              { uid: true }
            );
            return (
              rows
                .map((row) => ({ uid: toNumber(row.uid), size: toNumber(row.size) }))
                // `N:*` always yields the last message, even when its UID is below N.
                .filter((row) => row.uid > afterUid)
                .sort((a, b) => a.uid - b.uid)
            );
          },
          async fetchSource(uid, maxBytes) {
            const meta = await client.fetchOne(String(uid), { internalDate: true }, { uid: true });
            if (!meta) return null;
            // One byte more than the cap: seeing it proves the mail is over.
            const download = await client.download(String(uid), undefined, {
              uid: true,
              maxBytes: maxBytes + 1,
            });
            const chunks: Buffer[] = [];
            let total = 0;
            for await (const chunk of download.content) {
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              total += buffer.length;
              if (total > maxBytes) {
                download.content.destroy();
                return { tooLarge: true as const };
              }
              chunks.push(buffer);
            }
            const date = meta.internalDate ? new Date(meta.internalDate) : null;
            return {
              raw: Buffer.concat(chunks),
              internalDate: date && !Number.isNaN(date.getTime()) ? date : null,
            };
          },
          async markProcessed(uid, { keepUnread }) {
            const flags = processedFlags(keepUnread, supportsKeywords);
            if (flags.length === 0) return false;
            try {
              return await client.messageFlagsAdd(String(uid), flags, { uid: true });
            } catch (error) {
              logger.warn({ operation: "mail_intake_flag_failed", kind: classifyImapError(error) });
              return false;
            }
          },
        };
        return await run(session);
      } finally {
        lock.release();
      }
    } catch (error) {
      if (error instanceof MailIntakeError) throw error;
      throw new MailIntakeError(
        classifyImapError(error),
        error instanceof Error ? error.message : undefined
      );
    } finally {
      await client.logout().catch(() => client.close());
    }
  },

  async watch(connection, onNew, signal) {
    const client = clientFor(connection);
    const stop = (): void => {
      client.close();
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      await client.connect();
      const lock = await client.getMailboxLock(connection.folder, { readOnly: true });
      try {
        client.on("exists", () => onNew());
        while (!signal.aborted && client.usable) {
          await client.idle();
        }
      } finally {
        lock.release();
      }
    } finally {
      signal.removeEventListener("abort", stop);
      await client.logout().catch(() => client.close());
    }
  },
};
