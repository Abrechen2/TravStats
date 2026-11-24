/**
 * One run over one mailbox: connect, read what is new, push each mail through
 * the pipeline, flag it, and write the verdict on the source row so the
 * settings card can show it (spec §4). A run that fails says why, with its
 * time — `lastError` is a stable kind, never prose.
 */
import { prisma } from "../../db";
import { decrypt } from "../../utils/encryption";
import logger from "../../utils/logger";
import { DOCUMENT_SIZE_LIMITS } from "../documents/documentFormats";
import { connectionGate, loadPolicy } from "../externalServices/policy";
import {
  HEADER_BATCH,
  MAIL_INTAKE_SERVICE_ID,
  MAX_HEADERS_PER_RUN,
  MAX_MAILS_PER_RUN,
} from "./constants";
import {
  MailIntakeError,
  classifyImapError,
  collapseForPersonal,
  type SourceErrorKind,
} from "./errors";
import { pinPublic } from "./hostPolicy";
import {
  imapFetcher,
  type MailFetcher,
  type MailSession,
  type MailboxConnection,
  type TlsMode,
} from "./mailFetcher";
import { processMail } from "./pipeline";
import { buildRules, judge, type HeaderInfo, type PrefilterRules } from "./prefilter";

export interface RunResult {
  ran: boolean;
  /** Why nothing ran: switched off, or no such source. */
  skipped?: "disabled" | "service_off" | "running" | "missing";
  error?: SourceErrorKind;
  seen: number;
  proposed: number;
  /** Mails the header pre-filter left untouched (never downloaded, never flagged). */
  filtered: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const running = new Set<string>();

type SourceRow = NonNullable<Awaited<ReturnType<typeof prisma.mailIntakeSource.findUnique>>>;

/** The decrypted connection for a source, or the kind that stops it. */
export function connectionOf(source: SourceRow): MailboxConnection {
  if (!source.passwordEncrypted) throw new MailIntakeError("credentials_missing");
  // Plain IMAP is for the admin's own LAN mailbox only (spec §5.4).
  if (source.tlsMode === "none" && source.kind !== "instance_mailbox") {
    throw new MailIntakeError("plain_not_allowed");
  }
  let password: string;
  try {
    password = decrypt(source.passwordEncrypted);
  } catch {
    throw new MailIntakeError("credentials_missing", "stored password cannot be decrypted");
  }
  return {
    host: source.host,
    port: source.port,
    tlsMode: source.tlsMode as TlsMode,
    username: source.username,
    password,
    folder: source.folder,
  };
}

/**
 * The connection a run may open: decrypted, and for a personal folder checked
 * against the public-address policy and pinned to the checked address.
 */
export async function guardedConnection(source: SourceRow): Promise<MailboxConnection> {
  const connection = connectionOf(source);
  return source.kind === "imap_folder" ? pinPublic(connection) : connection;
}

/** The kind a failure is reported as: a personal folder's are collapsed (no port-scan oracle). */
export function reportedKind(
  source: Pick<SourceRow, "kind">,
  kind: SourceErrorKind
): SourceErrorKind {
  return source.kind === "imap_folder" ? collapseForPersonal(kind) : kind;
}

/** True when the admin or the owner has the feature off for this source. */
export async function isServiceOff(source: Pick<SourceRow, "userId">): Promise<boolean> {
  if (source.userId) {
    const gate = await connectionGate(MAIL_INTAKE_SERVICE_ID, source.userId);
    return gate.off !== null || !gate.accountMayConnect;
  }
  return (await loadPolicy()).disabled.includes(MAIL_INTAKE_SERVICE_ID);
}

export async function runSource(
  sourceId: string,
  fetcher: MailFetcher = imapFetcher
): Promise<RunResult> {
  const empty: RunResult = { ran: false, seen: 0, proposed: 0, filtered: 0 };
  // Taken before the first await: two callers (poll, IDLE, "check now") must not both enter.
  if (running.has(sourceId)) return { ...empty, skipped: "running" };
  running.add(sourceId);
  try {
    return await runLocked(sourceId, fetcher, empty);
  } finally {
    running.delete(sourceId);
  }
}

async function runLocked(
  sourceId: string,
  fetcher: MailFetcher,
  empty: RunResult
): Promise<RunResult> {
  const source = await prisma.mailIntakeSource.findUnique({ where: { id: sourceId } });
  if (!source) return { ...empty, skipped: "missing" };
  if (!source.enabled) return { ...empty, skipped: "disabled" };
  if (await isServiceOff(source)) return { ...empty, skipped: "service_off" };

  const startedAt = new Date();
  const result: RunResult = { ran: true, seen: 0, proposed: 0, filtered: 0 };
  try {
    const connection = await guardedConnection(source);
    await fetcher.withFolder(connection, (session) => readFolder(source, session, result));
    await prisma.mailIntakeSource.update({
      where: { id: source.id },
      data: { lastRunAt: startedAt, lastOkAt: new Date(), lastError: null, lastErrorAt: null },
    });
  } catch (error) {
    const kind = reportedKind(source, classifyImapError(error));
    result.error = kind;
    logger.warn({ operation: "mail_intake_run_failed", sourceId, kind, err: error });
    await prisma.mailIntakeSource.update({
      where: { id: source.id },
      data: { lastRunAt: startedAt, lastError: kind, lastErrorAt: new Date() },
    });
  }
  return result;
}

/**
 * Where a fresh cursor starts: never at 0 on a private mailbox. `now` skips
 * everything already there (UIDNEXT-1); `days_N` starts at the first mail of
 * the last N days, which the pre-filter still judges one by one.
 */
export async function startingUid(fetchFrom: string, session: MailSession): Promise<number> {
  const days = /^days_(\d+)$/.exec(fetchFrom)?.[1];
  const atNow = Math.max(session.uidNext - 1, 0);
  if (!days) return atNow;
  // eslint-disable-next-line time/no-ambient-now -- an IMAP SEARCH SINCE window, not a status clock
  const since = new Date(Date.now() - Number(days) * DAY_MS);
  const uids = await session.searchUids({ since, before: null });
  return uids.length > 0 ? uids[0] - 1 : atNow;
}

/** The pre-filter of a personal folder, or null when every mail is read (instance mailbox, switched off). */
export async function rulesFor(source: SourceRow): Promise<PrefilterRules | null> {
  if (source.kind !== "imap_folder" || !source.prefilter || !source.userId) return null;
  const senders = await prisma.mailIntakeSender.findMany({
    where: { userId: source.userId },
    select: { address: true },
  });
  return buildRules(
    source,
    senders.map((s) => s.address)
  );
}

async function readFolder(source: SourceRow, session: MailSession, result: RunResult) {
  // A changed UIDVALIDITY makes every stored UID meaningless, and a source that
  // never ran has none: the cursor is positioned by `fetchFrom`, never at 0.
  const restart = source.uidValidity === null || source.uidValidity !== session.uidValidity;
  let lastUid = restart ? await startingUid(source.fetchFrom, session) : source.lastUid;
  if (restart) await saveCursor(source, { lastUid, uidValidity: session.uidValidity });

  const rules = await rulesFor(source);
  const listed = (await session.listNew(lastUid)).slice(
    0,
    rules ? MAX_HEADERS_PER_RUN : MAX_MAILS_PER_RUN
  );
  let taken = 0;
  for (let i = 0; i < listed.length && taken < MAX_MAILS_PER_RUN; i += HEADER_BATCH) {
    const batch = listed.slice(i, i + HEADER_BATCH);
    const headers = rules
      ? new Map((await session.fetchHeaders(batch.map((b) => b.uid))).map((h) => [h.uid, h]))
      : null;
    let filtered = 0;
    for (const item of batch) {
      if (rules && headers && !passes(headers.get(item.uid), rules)) {
        // Not a booking: never downloaded, parsed, stored, logged or flagged. Counted.
        filtered += 1;
        lastUid = item.uid;
        continue;
      }
      if (taken >= MAX_MAILS_PER_RUN) break;
      taken += 1;
      await takeMail(source, session, item, result);
      lastUid = item.uid;
      await saveCursor(source, { lastUid, uidValidity: session.uidValidity });
    }
    if (filtered > 0) {
      result.filtered += filtered;
      await saveCursor(source, { lastUid, uidValidity: session.uidValidity });
      await prisma.mailIntakeSource.update({
        where: { id: source.id },
        data: { skippedCount: { increment: filtered } },
      });
    }
  }
  await saveCursor(source, { uidValidity: session.uidValidity });
}

function passes(header: HeaderInfo | undefined, rules: PrefilterRules): boolean {
  return !!header && judge(header, rules).take;
}

async function takeMail(
  source: SourceRow,
  session: MailSession,
  item: { uid: number; size: number },
  result: RunResult
): Promise<void> {
  result.seen += 1;
  // The listing's size is a hint only: the cap is enforced while downloading.
  const limit = DOCUMENT_SIZE_LIMITS.eml;
  const fetched =
    item.size > limit ? { tooLarge: true as const } : await session.fetchSource(item.uid, limit);
  if (fetched && "tooLarge" in fetched) {
    await recordTooLarge(source.id, source.userId, item.uid, session.uidValidity);
  } else if (fetched) {
    const outcome = await processMail(
      { id: source.id, userId: source.userId, kind: source.kind, authservId: source.authservId },
      { uid: item.uid, uidValidity: session.uidValidity, ...fetched }
    );
    if (outcome.status === "proposed") result.proposed += 1;
  }
  await session.markProcessed(item.uid, { keepUnread: source.keepUnread });
  await prisma.mailIntakeSource.update({
    where: { id: source.id },
    data: { processedCount: { increment: 1 } },
  });
}

/**
 * Writes the scan position only while the source still points at the mailbox
 * that was read: an owner who changed host, user or folder mid-run reset the
 * cursor on purpose, and the old mailbox's UIDs must not overwrite it.
 */
async function saveCursor(
  source: SourceRow,
  data: { lastUid?: number; uidValidity: string }
): Promise<void> {
  await prisma.mailIntakeSource.updateMany({
    where: {
      id: source.id,
      host: source.host,
      username: source.username,
      folder: source.folder,
    },
    data,
  });
}

async function recordTooLarge(
  sourceId: string,
  userId: string | null,
  uid: number,
  uidValidity: string
): Promise<void> {
  const messageId = `uid:${uidValidity}:${uid}`;
  const existing = await prisma.mailIntakeMessage.findFirst({
    where: { sourceId, messageId, userId },
    select: { id: true },
  });
  if (existing) return;
  // On the instance mailbox the recipient is unknown (the mail was not opened), so the
  // row has no owner: it shows only in the admin's logs, not in anyone's inbox.
  logger.warn({ operation: "mail_intake_mail_too_large", sourceId, uid, owned: userId !== null });
  await prisma.mailIntakeMessage.create({
    data: { sourceId, userId, messageId, uid, status: "failed", reason: "mail_too_large" },
  });
}
