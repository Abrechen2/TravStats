/**
 * Reading and writing the mailbox settings (personal folder and instance
 * mailbox), the forwarding address and the allowed senders. The password goes
 * in encrypted and never comes out: views carry `hasPassword` only.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { encrypt } from "../../utils/encryption";
import { connectionGate, loadPolicy } from "../externalServices/policy";
import { MAIL_INTAKE_SERVICE_ID } from "./constants";
import {
  MailIntakeError,
  classifyImapError,
  SOURCE_ERROR_KINDS,
  type SourceErrorKind,
} from "./errors";
import { addressFor, currentToken, revokeToken, rotateToken } from "./addressToken";
import { imapFetcher, type MailFetcher } from "./mailFetcher";
import { guardedConnection, reportedKind } from "./runSource";
import { resolvePublicHost } from "./hostPolicy";
import { stopWatcher } from "./idleWatchers";
import { FETCH_FROM_OPTIONS, type FetchFrom } from "./constants";
import { defaultKeywords, defaultSenderDomains, normalizeDomain } from "./prefilter";

type SourceRow = NonNullable<Awaited<ReturnType<typeof prisma.mailIntakeSource.findUnique>>>;

export interface SourceView {
  host: string;
  port: number;
  tlsMode: "tls" | "starttls" | "none";
  username: string;
  address: string | null;
  authservId: string | null;
  folder: string;
  enabled: boolean;
  hasPassword: boolean;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: SourceErrorKind | null;
  lastErrorAt: string | null;
  prefilter: boolean;
  keepUnread: boolean;
  fetchFrom: FetchFrom;
  senderDomains: string[];
  removedSenderDomains: string[];
  subjectKeywords: string[];
  removedSubjectKeywords: string[];
  skippedCount: number;
  processedCount: number;
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

function asKind(value: string | null): SourceErrorKind | null {
  return (SOURCE_ERROR_KINDS as readonly string[]).includes(value ?? "")
    ? (value as SourceErrorKind)
    : null;
}

export function viewOf(source: SourceRow): SourceView {
  return {
    host: source.host,
    port: source.port,
    tlsMode: source.tlsMode as SourceView["tlsMode"],
    username: source.username,
    address: source.address,
    authservId: source.authservId,
    folder: source.folder,
    enabled: source.enabled,
    hasPassword: !!source.passwordEncrypted,
    lastRunAt: iso(source.lastRunAt),
    lastOkAt: iso(source.lastOkAt),
    lastError: asKind(source.lastError),
    lastErrorAt: iso(source.lastErrorAt),
    prefilter: source.prefilter,
    keepUnread: source.keepUnread,
    fetchFrom: (FETCH_FROM_OPTIONS as readonly string[]).includes(source.fetchFrom)
      ? (source.fetchFrom as FetchFrom)
      : "now",
    senderDomains: source.senderDomains,
    removedSenderDomains: source.removedSenderDomains,
    subjectKeywords: source.subjectKeywords,
    removedSubjectKeywords: source.removedSubjectKeywords,
    skippedCount: source.skippedCount,
    processedCount: source.processedCount,
  };
}

/** The built-in pre-filter lists the settings show read-only (each default can be switched off). */
export function prefilterDefaults() {
  const keywords = defaultKeywords();
  return {
    senderDomains: defaultSenderDomains().map(({ domain, brand, kind }) => ({
      domain,
      brand,
      kind,
    })),
    keywords: {
      de: keywords.filter((k) => k.lang === "de").map((k) => k.word),
      en: keywords.filter((k) => k.lang === "en").map((k) => k.word),
    },
  };
}

export type Off = "admin" | "account" | "forbidden" | null;

export async function offFor(userId: string): Promise<Off> {
  const gate = await connectionGate(MAIL_INTAKE_SERVICE_ID, userId);
  if (gate.off) return gate.off;
  return gate.accountMayConnect ? null : "forbidden";
}

async function instanceSource(): Promise<SourceRow | null> {
  return prisma.mailIntakeSource.findFirst({ where: { userId: null } });
}

export async function forwardingAvailable(): Promise<boolean> {
  const source = await instanceSource();
  if (!source || !source.enabled || !source.address || !source.passwordEncrypted) return false;
  return !(await loadPolicy()).disabled.includes(MAIL_INTAKE_SERVICE_ID);
}

export async function buildStatus(userId: string) {
  const [off, source, senders, available, instance, token] = await Promise.all([
    offFor(userId),
    prisma.mailIntakeSource.findUnique({ where: { userId } }),
    prisma.mailIntakeSender.findMany({ where: { userId }, orderBy: { address: "asc" } }),
    forwardingAvailable(),
    instanceSource(),
    currentToken(userId),
  ]);
  return {
    off,
    source: source ? viewOf(source) : null,
    address: available && token ? addressFor(instance?.address, token) : null,
    forwardingAvailable: available,
    senders: senders.map((s) => ({ id: s.id, address: s.address })),
    prefilterDefaults: prefilterDefaults(),
  };
}

interface SourceInput {
  host: string;
  port: number;
  tlsMode: "tls" | "starttls" | "none";
  username: string;
  address?: string;
  authservId?: string | null;
  password?: string;
  folder: string;
  enabled?: boolean;
  prefilter?: boolean;
  keepUnread?: boolean;
  fetchFrom?: FetchFrom;
  senderDomains?: string[];
  removedSenderDomains?: string[];
  subjectKeywords?: string[];
  removedSubjectKeywords?: string[];
}

const uniq = (values: string[]): string[] => [...new Set(values)];

/** Creates or updates the personal (`userId`) or the instance (`null`) source. */
export async function saveSource(userId: string | null, input: SourceInput): Promise<SourceView> {
  const existing = userId
    ? await prisma.mailIntakeSource.findUnique({ where: { userId } })
    : await instanceSource();
  if (!existing && !input.password) {
    throw new AppError("A password is required for a new mailbox", 400, "VALIDATION_FAILED");
  }
  // A personal host must resolve to public addresses only (SSRF); re-checked on every connect.
  if (userId) {
    try {
      await resolvePublicHost(input.host);
    } catch (error) {
      if (error instanceof MailIntakeError && error.kind === "blocked_host") {
        throw new AppError("This host is not a public address", 400, "MAIL_HOST_BLOCKED");
      }
      // Unresolvable now: saved anyway, the next test says `unreachable`.
    }
  }
  const passwordEncrypted = input.password
    ? encrypt(input.password)
    : (existing?.passwordEncrypted ?? null);
  // A different mailbox starts its scan over; its UIDs mean nothing here.
  const moved =
    !!existing &&
    (existing.host !== input.host ||
      existing.username !== input.username ||
      existing.folder !== input.folder);
  const enabled = (input.enabled ?? existing?.enabled ?? false) && !!passwordEncrypted;
  const fetchFrom = input.fetchFrom ?? (existing?.fetchFrom as FetchFrom | undefined) ?? "now";
  // A new starting point is a new scan: the cursor is positioned again on the next run.
  const restartScan = moved || (!!existing && existing.fetchFrom !== fetchFrom);
  // A private INBOX keeps its mails unread unless the user says otherwise.
  const keepUnread =
    input.keepUnread ??
    (existing && !moved ? existing.keepUnread : !!userId && input.folder.toUpperCase() === "INBOX");
  const data = {
    host: input.host,
    port: input.port,
    tlsMode: input.tlsMode,
    username: input.username,
    address: userId ? null : (input.address ?? null),
    // undefined keeps the stored id, an explicit null clears it.
    authservId: userId
      ? null
      : input.authservId === undefined
        ? (existing?.authservId ?? null)
        : input.authservId || null,
    folder: input.folder,
    passwordEncrypted,
    enabled,
    fetchFrom,
    keepUnread,
    ...(input.prefilter !== undefined ? { prefilter: input.prefilter } : {}),
    ...(input.senderDomains
      ? { senderDomains: uniq(input.senderDomains.map(normalizeDomain)) }
      : {}),
    ...(input.removedSenderDomains
      ? { removedSenderDomains: uniq(input.removedSenderDomains.map(normalizeDomain)) }
      : {}),
    ...(input.subjectKeywords
      ? { subjectKeywords: uniq(input.subjectKeywords.map((w) => w.trim())) }
      : {}),
    ...(input.removedSubjectKeywords
      ? { removedSubjectKeywords: uniq(input.removedSubjectKeywords.map((w) => w.trim())) }
      : {}),
    ...(restartScan ? { uidValidity: null, lastUid: 0 } : {}),
  };
  const saved = existing
    ? await prisma.mailIntakeSource.update({ where: { id: existing.id }, data })
    : await prisma.mailIntakeSource.create({
        data: { ...data, kind: userId ? "imap_folder" : "instance_mailbox", userId },
      });
  // A settings change closes any IDLE connection holding the old ones.
  stopWatcher(saved.id);
  return viewOf(saved);
}

export async function deleteSource(userId: string | null): Promise<void> {
  const existing = userId
    ? await prisma.mailIntakeSource.findUnique({ where: { userId } })
    : await instanceSource();
  if (!existing) return;
  stopWatcher(existing.id);
  // Its message rows go with it; the mails stay as Documents until filed or swept.
  await prisma.mailIntakeSource.delete({ where: { id: existing.id } });
}

export async function testSource(
  userId: string | null,
  fetcher: MailFetcher = imapFetcher
): Promise<{ ok: boolean; error: SourceErrorKind | null }> {
  const source = userId
    ? await prisma.mailIntakeSource.findUnique({ where: { userId } })
    : await instanceSource();
  if (!source) throw new AppError("No mailbox is set up", 404, "MAIL_SOURCE_NOT_FOUND");
  try {
    // Opens the folder and nothing else; reads and changes no mail.
    await fetcher.withFolder(await guardedConnection(source), async () => undefined);
    return { ok: true, error: null };
  } catch (error) {
    const kind = error instanceof MailIntakeError ? error.kind : classifyImapError(error);
    return { ok: false, error: reportedKind(source, kind) };
  }
}

export async function issueAddress(userId: string): Promise<string | null> {
  const instance = await instanceSource();
  if (!(await forwardingAvailable())) {
    throw new AppError(
      "Forwarding addresses are not set up on this instance",
      409,
      "NOT_CONFIGURED"
    );
  }
  return addressFor(instance?.address, await rotateToken(userId));
}

export async function revokeAddress(userId: string): Promise<void> {
  await revokeToken(userId);
}

export async function addSender(userId: string, address: string): Promise<void> {
  await prisma.mailIntakeSender.upsert({
    where: { userId_address: { userId, address } },
    create: { userId, address },
    update: {},
  });
}

export async function removeSender(userId: string, id: string): Promise<void> {
  await prisma.mailIntakeSender.deleteMany({ where: { id, userId } });
}
