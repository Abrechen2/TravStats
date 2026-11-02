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
import { MAIL_INTAKE_SERVICE_ID, MAX_MAILS_PER_RUN } from "./constants";
import {
  MailIntakeError,
  classifyImapError,
  collapseForPersonal,
  type SourceErrorKind,
} from "./errors";
import { pinPublic } from "./hostPolicy";
import { imapFetcher, type MailFetcher, type MailboxConnection, type TlsMode } from "./mailFetcher";
import { processMail } from "./pipeline";

export interface RunResult {
  ran: boolean;
  /** Why nothing ran: switched off, or no such source. */
  skipped?: "disabled" | "service_off" | "running" | "missing";
  error?: SourceErrorKind;
  seen: number;
  proposed: number;
}

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
  const empty: RunResult = { ran: false, seen: 0, proposed: 0 };
  if (running.has(sourceId)) return { ...empty, skipped: "running" };
  const source = await prisma.mailIntakeSource.findUnique({ where: { id: sourceId } });
  if (!source) return { ...empty, skipped: "missing" };
  if (!source.enabled) return { ...empty, skipped: "disabled" };
  if (await isServiceOff(source)) return { ...empty, skipped: "service_off" };

  running.add(sourceId);
  const startedAt = new Date();
  const result: RunResult = { ran: true, seen: 0, proposed: 0 };
  try {
    const connection = await guardedConnection(source);
    await fetcher.withFolder(connection, async (session) => {
      // A changed UIDVALIDITY makes every stored UID meaningless: start over.
      // The Message-ID key keeps the rescan from creating anything twice.
      const restart = source.uidValidity !== null && source.uidValidity !== session.uidValidity;
      let lastUid = restart ? 0 : source.lastUid;
      const fresh = (await session.listNew(lastUid)).slice(0, MAX_MAILS_PER_RUN);

      for (const item of fresh) {
        result.seen += 1;
        // The listing's size is a hint only: the cap is enforced while downloading.
        const limit = DOCUMENT_SIZE_LIMITS.eml;
        const fetched =
          item.size > limit
            ? { tooLarge: true as const }
            : await session.fetchSource(item.uid, limit);
        if (fetched && "tooLarge" in fetched) {
          await recordTooLarge(source.id, source.userId, item.uid, session.uidValidity);
        } else if (fetched) {
          const outcome = await processMail(
            {
              id: source.id,
              userId: source.userId,
              kind: source.kind,
              authservId: source.authservId,
            },
            { uid: item.uid, uidValidity: session.uidValidity, ...fetched }
          );
          if (outcome.status === "proposed") result.proposed += 1;
        }
        await session.markProcessed(item.uid);
        lastUid = item.uid;
        await prisma.mailIntakeSource.update({
          where: { id: source.id },
          data: { lastUid, uidValidity: session.uidValidity },
        });
      }
      await prisma.mailIntakeSource.update({
        where: { id: source.id },
        data: { uidValidity: session.uidValidity, ...(restart ? { lastUid } : {}) },
      });
    });
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
  } finally {
    running.delete(sourceId);
  }
  return result;
}

async function recordTooLarge(
  sourceId: string,
  userId: string | null,
  uid: number,
  uidValidity: string
): Promise<void> {
  await prisma.mailIntakeMessage.upsert({
    where: { sourceId_messageId: { sourceId, messageId: `uid:${uidValidity}:${uid}` } },
    create: {
      sourceId,
      userId,
      messageId: `uid:${uidValidity}:${uid}`,
      uid,
      status: "failed",
      reason: "mail_too_large",
    },
    update: {},
  });
}
