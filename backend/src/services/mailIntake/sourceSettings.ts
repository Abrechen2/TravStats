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
}

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
  const data = {
    host: input.host,
    port: input.port,
    tlsMode: input.tlsMode,
    username: input.username,
    address: userId ? null : (input.address ?? null),
    folder: input.folder,
    passwordEncrypted,
    enabled,
    ...(moved ? { uidValidity: null, lastUid: 0 } : {}),
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
