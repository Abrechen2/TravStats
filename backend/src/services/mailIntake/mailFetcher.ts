/**
 * The IMAP side of the mail intake, behind an interface so the pipeline is
 * tested without a server and the real client is tested against GreenMail
 * (`__tests__/imapFetcher.greenmail.test.ts`).
 *
 * Only the configured folder is ever opened. The rest of the mailbox is never
 * listed (spec §3 A), and nothing is deleted or moved: a processed mail gets
 * `\Seen` and the keyword `$TravStats` (decision 3).
 */
import { ImapFlow } from "imapflow";

import logger from "../../utils/logger";
import { MailIntakeError, classifyImapError } from "./errors";

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
  /** Best effort: flags `\Seen` and `$TravStats`. Returns false when the server refused. */
  markProcessed(uid: number): Promise<boolean>;
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
        const session: MailSession = {
          uidValidity: mailbox ? String(mailbox.uidValidity) : "0",
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
          async markProcessed(uid) {
            try {
              return await client.messageFlagsAdd(String(uid), ["\\Seen", PROCESSED_KEYWORD], {
                uid: true,
              });
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
