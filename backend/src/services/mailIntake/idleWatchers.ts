/**
 * IMAP IDLE next to the 5-minute poll (decision 6): a booking mail shows up as
 * a proposal within seconds where the server supports IDLE, and within five
 * minutes where it does not or the connection dropped. The poll is the safety
 * net, so a watcher that ends — for any reason — is simply not restarted until
 * the next tick; it never retries on its own and cannot hammer a mail server.
 */
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { classifyImapError } from "./errors";
import { imapFetcher, type MailFetcher } from "./mailFetcher";
import { guardedConnection, isServiceOff, runSource } from "./runSource";

/** One IDLE connection per source; this caps the sockets a large instance opens. */
export const MAX_WATCHERS = 10;
const DEBOUNCE_MS = 3_000;

const active = new Map<string, AbortController>();

export function activeWatcherCount(): number {
  return active.size;
}

export async function ensureWatchers(fetcher: MailFetcher = imapFetcher): Promise<void> {
  const sources = await prisma.mailIntakeSource.findMany({ where: { enabled: true } });
  // A watcher outlives a switch: close the ones whose source is gone, off, or whose
  // service the admin has switched off since, so no authenticated connection lingers.
  const usable = new Set<string>();
  for (const source of sources) if (!(await isServiceOff(source))) usable.add(source.id);
  for (const id of [...active.keys()]) if (!usable.has(id)) stopWatcher(id);
  for (const source of sources) {
    if (active.has(source.id) || active.size >= MAX_WATCHERS) continue;
    if (await isServiceOff(source)) continue;
    let connection;
    try {
      connection = await guardedConnection(source);
    } catch {
      continue; // the poll records why this source cannot run
    }
    const controller = new AbortController();
    active.set(source.id, controller);
    let timer: NodeJS.Timeout | undefined;
    const onNew = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => void runSource(source.id, fetcher), DEBOUNCE_MS);
    };
    void fetcher
      .watch(connection, onNew, controller.signal)
      .catch((error: unknown) => {
        logger.info({ operation: "mail_intake_idle_ended", kind: classifyImapError(error) });
      })
      .finally(() => {
        clearTimeout(timer);
        active.delete(source.id);
      });
  }
}

export function stopWatchers(): void {
  for (const controller of active.values()) controller.abort();
  active.clear();
}

/** Drops the watcher of one source (settings changed, source switched off). */
export function stopWatcher(sourceId: string): void {
  active.get(sourceId)?.abort();
  active.delete(sourceId);
}
