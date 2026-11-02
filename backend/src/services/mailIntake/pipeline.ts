/**
 * One fetched mail → a stored Document and an inbox proposal (spec §4).
 *
 * The raw mail is kept as a Document BEFORE it is parsed, so a parser failure
 * leaves the original behind with a retry button instead of a mail that exists
 * nowhere. Nothing here creates an entry: a proposal becomes one only when the
 * user confirms it (decision 2).
 */
import type { Prisma } from "../../prisma";
import { prisma } from "../../db";
import { extractEmailFromFile } from "../emailExtractor";
import { parseDocument, type ParsedDocumentBody } from "../parsing/parseDocument";
import { createDocument } from "../documents/documentService";
import { exceededLimit } from "../documents/documentFormats";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { filterConnectionAllowed } from "../externalServices/policy";
import { MAIL_INTAKE_SERVICE_ID, PARSE_TIMEOUT_MS } from "./constants";
import type { MessageReason } from "./errors";
import { tokensIn, userIdForToken } from "./addressToken";
import { readHeaders, type MailHeaders } from "./mailHeaders";

export type MessageStatus = "proposed" | "duplicate" | "nothing" | "rejected" | "failed";

export interface SourceRef {
  id: string;
  userId: string | null;
  kind: string;
  authservId?: string | null;
}

export interface MailInput {
  uid: number;
  uidValidity: string;
  raw: Buffer;
  internalDate: Date | null;
}

export interface MailOutcome {
  status: MessageStatus | "skipped";
  reason: MessageReason | null;
}

/** How many entries a parse found, per domain. Exported for tests. */
export function countFound(body: ParsedDocumentBody): number {
  switch (body.domain) {
    case "flight":
      return body.flights.length;
    case "cruise":
      return body.cruises.length;
    case "rail":
      return body.bookings.length;
    case "package":
      return body.package ? 1 : 0;
    case "bus":
    case "ferry":
      return body.tickets.length;
    default:
      return body.candidates.length;
  }
}

function syntheticMessageId(input: MailInput): string {
  return `uid:${input.uidValidity}:${input.uid}`;
}

function fileNameFor(subject: string | null): string {
  const base = (subject ?? "mail")
    .replace(/[^\p{L}\p{N}._ -]+/gu, " ")
    .trim()
    .slice(0, 80);
  return `${base || "mail"}.eml`;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("parser timeout")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

interface Recorded {
  status: MessageStatus;
  reason?: MessageReason | null;
  userId: string | null;
  documentId?: string | null;
  domain?: string | null;
  summary?: Prisma.InputJsonValue;
}

async function record(
  source: SourceRef,
  input: MailInput,
  headers: MailHeaders | null,
  messageId: string,
  result: Recorded
): Promise<MailOutcome> {
  try {
    await prisma.mailIntakeMessage.create({
      data: {
        sourceId: source.id,
        userId: result.userId,
        messageId,
        uid: input.uid,
        receivedAt: headers?.sentAt ?? input.internalDate,
        fromAddress: headers?.from ?? null,
        subject: headers?.subject ?? null,
        documentId: result.documentId ?? null,
        status: result.status,
        reason: result.reason ?? null,
        domain: result.domain ?? null,
        ...(result.summary ? { summary: result.summary } : {}),
        authResult: headers?.dmarc ?? null,
      },
    });
  } catch (error) {
    // A parallel run recorded the same mail first: idempotent, not an error.
    if ((error as { code?: string }).code === "P2002") return { status: "skipped", reason: null };
    throw error;
  }
  return { status: result.status, reason: result.reason ?? null };
}

/** Who a mail belongs to and whether they may receive it; a rejection says why. */
async function authorise(
  source: SourceRef,
  headers: MailHeaders
): Promise<{ userId: string } | { userId: string | null; reason: MessageReason }> {
  if (source.kind === "imap_folder" && source.userId) return { userId: source.userId };

  let userId: string | null = null;
  for (const token of tokensIn(headers.recipientValues)) {
    userId = await userIdForToken(token);
    if (userId) break;
  }
  if (!userId) return { userId: null, reason: "unknown_token" };

  if ((await filterConnectionAllowed(MAIL_INTAKE_SERVICE_ID, [userId])).length === 0) {
    return { userId, reason: "service_off" };
  }
  // Only the From address DMARC vouched for may authorise. Sender, Return-Path and
  // X-Original-Sender are written by whoever sends the mail and prove nothing.
  const allowed = headers.from
    ? await prisma.mailIntakeSender.findFirst({
        where: { userId, address: headers.from },
        select: { id: true },
      })
    : null;
  if (!allowed) return { userId, reason: "sender_not_allowed" };
  if (headers.dmarc === "fail") return { userId, reason: "dmarc_failed" };
  if (headers.dmarc !== "pass") return { userId, reason: "dmarc_unverified" };
  return { userId };
}

function failureReason(error: unknown): MessageReason {
  const text = error instanceof Error ? error.message : "";
  return /timeout|timed out|abort|etimedout/i.test(text) ? "parser_timeout" : "parse_failed";
}

export async function processMail(source: SourceRef, input: MailInput): Promise<MailOutcome> {
  let headers: MailHeaders;
  try {
    headers = readHeaders(input.raw, source.authservId ?? null);
  } catch (error) {
    logger.warn({ operation: "mail_intake_unreadable", uid: input.uid, err: error });
    return record(source, input, null, syntheticMessageId(input), {
      status: "failed",
      reason: "unreadable_mail",
      userId: source.userId,
    });
  }
  const messageId = headers.messageId ?? syntheticMessageId(input);

  const seen = await prisma.mailIntakeMessage.findUnique({
    where: { sourceId_messageId: { sourceId: source.id, messageId } },
    select: { id: true },
  });
  if (seen) return { status: "skipped", reason: null };

  const verdict = await authorise(source, headers);
  if ("reason" in verdict) {
    // Rejected mail is logged and never parsed or stored (spec §4/§5).
    return record(source, input, headers, messageId, {
      status: "rejected",
      reason: verdict.reason,
      userId: verdict.userId,
    });
  }
  const userId = verdict.userId;

  if (exceededLimit("eml", input.raw.length) !== null) {
    return record(source, input, headers, messageId, {
      status: "failed",
      reason: "mail_too_large",
      userId,
    });
  }

  let documentId: string;
  let created: boolean;
  try {
    const kept = await createDocument({
      userId,
      buffer: input.raw,
      originalName: fileNameFor(headers.subject),
      declaredFormat: "eml",
      source: "mail",
    });
    documentId = kept.document.id;
    created = kept.created;
  } catch (error) {
    logger.warn({
      operation: "mail_intake_document_not_kept",
      status: error instanceof AppError ? error.statusCode : undefined,
    });
    return record(source, input, headers, messageId, {
      status: "failed",
      reason:
        error instanceof AppError && error.statusCode === 413
          ? "mail_too_large"
          : "document_not_kept",
      userId,
    });
  }
  if (!created) {
    return record(source, input, headers, messageId, {
      status: "duplicate",
      userId,
      documentId,
    });
  }
  return parseKept(source, input, headers, messageId, userId, documentId);
}

/** Parses the kept mail and records the proposal. Also the retry path. */
export async function parseKept(
  source: SourceRef,
  input: MailInput,
  headers: MailHeaders,
  messageId: string,
  userId: string,
  documentId: string
): Promise<MailOutcome> {
  const outcome = await classifyKept(
    userId,
    input.raw,
    headers.sentAt ?? input.internalDate,
    documentId
  );
  return record(source, input, headers, messageId, { userId, documentId, ...outcome });
}

export interface Classified {
  status: MessageStatus;
  reason: MessageReason | null;
  domain: string | null;
  summary?: Prisma.InputJsonValue;
}

export async function classifyKept(
  userId: string,
  raw: Buffer,
  referenceDate: Date | null,
  documentId: string
): Promise<Classified> {
  try {
    const extracted = extractEmailFromFile(raw, "mail.eml");
    const result = await withTimeout(
      parseDocument({
        text: extracted.text,
        subject: extracted.subject || undefined,
        ...(extracted.html ? { html: extracted.html } : {}),
        ...(extracted.attachments ? { attachments: extracted.attachments } : {}),
        ...(extracted.from ? { from: extracted.from } : {}),
        ...(extracted.sentAt ? { sentAt: extracted.sentAt } : {}),
        domain: "auto",
        source: "email",
        userId,
        ...(referenceDate ? { referenceDate } : {}),
      }),
      PARSE_TIMEOUT_MS
    );
    await prisma.document.update({
      where: { id: documentId },
      data: {
        parsedDomain: result.domain,
        parsedPayload: result.body as unknown as Prisma.InputJsonValue,
      },
    });
    const found = countFound(result.body);
    if (found === 0) {
      return {
        status: "nothing",
        reason: result.body.llmDisabledByAdmin ? "llm_not_allowed" : "nothing_found",
        domain: result.domain,
      };
    }
    return {
      status: "proposed",
      reason: null,
      domain: result.domain,
      summary: { found } as Prisma.InputJsonValue,
    };
  } catch (error) {
    logger.warn({ operation: "mail_intake_parse_failed", err: error });
    return { status: "failed", reason: failureReason(error), domain: null };
  }
}
