/**
 * The inbox side of the mail intake: what the user sees as cards, and what
 * they can do with them. A card is a `MailIntakeMessage` the user still has to
 * act on — a proposal, a rejection they may reverse, a mail that failed or
 * yielded nothing. Discarding hides the card and keeps the mail as an unfiled
 * Document until the sweep (spec §7).
 */
import fsp from "fs/promises";

import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { documentPath } from "../documents/documentStore";
import { linkDocuments, unfiledDeletesAt } from "../documents/documentService";
import { SOURCE_ERROR_KINDS, type MessageReason, type SourceErrorKind } from "./errors";
import { addSender } from "./sourceSettings";
import { classifyKept } from "./pipeline";

const LIMIT = 50;
const ACTIONABLE = ["proposed", "rejected", "failed", "nothing"] as const;
/** Rejections worth a card: the user can act on them. The rest only sit in the audit. */
const NOTED_REJECTIONS: MessageReason[] = [
  "sender_not_allowed",
  "dmarc_failed",
  "dmarc_unverified",
  "from_invalid",
];

function foundOf(summary: unknown): number | null {
  const found = (summary as { found?: unknown } | null)?.found;
  return typeof found === "number" ? found : null;
}

export async function buildInbox(userId: string) {
  const [rows, source] = await Promise.all([
    prisma.mailIntakeMessage.findMany({
      where: {
        userId,
        dismissedAt: null,
        status: { in: [...ACTIONABLE] },
        OR: [{ status: { not: "rejected" } }, { reason: { in: NOTED_REJECTIONS } }],
        // A proposal whose original has been filed with an entry is done.
        NOT: { document: { linkedAt: { not: null } } },
      },
      include: { document: { select: { unlinkedAt: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIMIT,
    }),
    prisma.mailIntakeSource.findUnique({ where: { userId } }),
  ]);
  const problem = (SOURCE_ERROR_KINDS as readonly string[]).includes(source?.lastError ?? "")
    ? (source!.lastError as SourceErrorKind)
    : null;
  return {
    items: rows.map((row) => ({
      id: row.id,
      status: row.status as "proposed" | "rejected" | "failed" | "nothing",
      reason: row.reason as MessageReason | null,
      from: row.fromAddress,
      subject: row.subject,
      receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
      domain: row.domain,
      found: foundOf(row.summary),
      documentId: row.documentId,
      deletesAt: row.document ? (unfiledDeletesAt(row.document)?.toISOString() ?? null) : null,
    })),
    sourceProblem: problem
      ? { error: problem, at: source?.lastErrorAt ? source.lastErrorAt.toISOString() : null }
      : null,
  };
}

async function ownMessage(userId: string, id: string) {
  const row = await prisma.mailIntakeMessage.findFirst({ where: { id, userId } });
  if (!row) throw new AppError("No such mail", 404, "MAIL_MESSAGE_NOT_FOUND");
  return row;
}

export async function dismissMessage(userId: string, id: string): Promise<void> {
  await ownMessage(userId, id);
  await prisma.mailIntakeMessage.update({ where: { id }, data: { dismissedAt: new Date() } });
}

/** "Allow this sender": takes effect for the next forward; the rejected mail was not kept. */
export async function allowSenderOf(userId: string, id: string): Promise<void> {
  const row = await ownMessage(userId, id);
  if (row.reason !== "sender_not_allowed" || !row.fromAddress) {
    throw new AppError("This mail was not rejected for its sender", 409, "MAIL_MESSAGE_NOT_FOUND");
  }
  await addSender(userId, row.fromAddress);
  await prisma.mailIntakeMessage.update({ where: { id }, data: { dismissedAt: new Date() } });
}

/** Reads a failed or empty mail again from the kept original. */
export async function retryMessage(userId: string, id: string): Promise<void> {
  const row = await ownMessage(userId, id);
  if (!row.documentId || !["failed", "nothing"].includes(row.status)) {
    throw new AppError("This mail cannot be read again", 409, "MAIL_DOCUMENT_GONE");
  }
  const document = await prisma.document.findFirst({
    where: { id: row.documentId, userId },
    select: { storedName: true },
  });
  let raw: Buffer;
  try {
    if (!document) throw new Error("missing");
    raw = await fsp.readFile(documentPath(document.storedName));
  } catch {
    throw new AppError("The kept original is gone", 409, "MAIL_DOCUMENT_GONE");
  }
  const outcome = await classifyKept(userId, raw, row.receivedAt, row.documentId);
  await prisma.mailIntakeMessage.update({
    where: { id },
    data: {
      status: outcome.status,
      reason: outcome.reason,
      domain: outcome.domain,
      summary: outcome.summary ?? undefined,
      dismissedAt: null,
    },
  });
}

/** Where each parsed domain's entries live, newest first by creation time. */
const ENTRY_LOOKUP = {
  flight: (userId: string, since: Date) =>
    prisma.flight.findFirst({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
  cruise: (userId: string, since: Date) =>
    prisma.cruise.findFirst({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
  lodging: (userId: string, since: Date) =>
    prisma.lodgingStay.findFirst({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
  rail: (userId: string, since: Date) =>
    prisma.railJourney.findFirst({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
  rental: (userId: string, since: Date) =>
    prisma.rentalBooking.findFirst({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
} as const;
const ENTRY_TYPE = {
  flight: "flight",
  cruise: "cruise",
  lodging: "lodgingStay",
  rail: "railJourney",
  rental: "rentalBooking",
} as const;

/**
 * Files the proposal's original mail with the entry the user created from it
 * (owner rule: always attach the original). The import dialogs create entries
 * through domain-specific routes that do not hand an id back, so the entry is
 * found as the first of the proposal's domain the account created since the
 * user opened the proposal — never before the mail itself arrived. Filing uses
 * the ordinary Document linking (`linkDocuments`), so the .eml ends up on the
 * flight, cruise, stay, ride or rental like any other kept original. A document
 * belongs to one entry: with several entries from one mail it goes to the first.
 *
 * Returns the entry it was filed with, or null when none was created (the card
 * stays — nothing was lost, the user may not have saved).
 */
export async function fileOriginalWithEntry(
  userId: string,
  id: string,
  openedAt: Date
): Promise<{ type: string; id: string } | null> {
  const row = await ownMessage(userId, id);
  const domain = row.domain as keyof typeof ENTRY_LOOKUP | null;
  if (!row.documentId || !domain || !(domain in ENTRY_LOOKUP)) {
    throw new AppError(
      "This proposal has no entry to file the mail with",
      409,
      "MAIL_DOCUMENT_GONE"
    );
  }
  const since = new Date(Math.max(openedAt.getTime(), row.createdAt.getTime()));
  const entry = await ENTRY_LOOKUP[domain](userId, since);
  if (!entry) return null;
  const ref = { type: ENTRY_TYPE[domain], id: entry.id };
  await linkDocuments(userId, [row.documentId], ref);
  await prisma.mailIntakeMessage.update({ where: { id }, data: { dismissedAt: new Date() } });
  return ref;
}
