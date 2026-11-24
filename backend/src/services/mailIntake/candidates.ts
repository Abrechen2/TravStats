/**
 * The scan's "probably missing" list: read, ignore (remembered), import.
 *
 * Import is the only moment a listed mail is downloaded. It runs the normal
 * pipeline (stored Document, inbox proposal) and flags the mail `$TravStats`
 * (plus `\Seen` unless the source keeps mails unread). Before downloading, the
 * UID's headers are read again: a mail that is no longer the one listed (the
 * folder was rebuilt, the mail deleted) is refused, never swapped for another.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { DOCUMENT_SIZE_LIMITS } from "../documents/documentFormats";
import { startJob, type JobView } from "../jobs/jobRegistry";
import { classifyImapError } from "./errors";
import { imapFetcher, type MailFetcher, type MailSession } from "./mailFetcher";
import { processMail } from "./pipeline";
import { guardedConnection, isServiceOff, reportedKind } from "./runSource";
import { getScan, type ScanView } from "./mailboxScan";

export type CandidateReason = "mail_gone" | "mail_too_large";

export interface CandidateView {
  id: string;
  receivedAt: string | null;
  from: string | null;
  subject: string | null;
  brand: string | null;
  guessedDomain: string | null;
  matchHint: "likely_present" | null;
  status: "open" | "failed";
  reason: string | null;
}

export async function listCandidates(userId: string): Promise<{
  scan: ScanView | null;
  items: CandidateView[];
  ignoredCount: number;
}> {
  const [scan, rows, ignoredCount] = await Promise.all([
    getScan(userId),
    prisma.mailIntakeCandidate.findMany({
      where: { userId, status: { in: ["open", "failed"] } },
      orderBy: [{ receivedAt: "desc" }, { uid: "desc" }],
      take: 1000,
    }),
    prisma.mailIntakeCandidate.count({ where: { userId, status: "ignored" } }),
  ]);
  return {
    scan,
    ignoredCount,
    items: rows.map((r) => ({
      id: r.id,
      receivedAt: r.receivedAt ? r.receivedAt.toISOString() : null,
      from: r.fromAddress,
      subject: r.subject,
      brand: r.brand,
      guessedDomain: r.guessedDomain,
      matchHint: r.matchHint === "likely_present" ? "likely_present" : null,
      status: r.status === "failed" ? "failed" : "open",
      reason: r.reason,
    })),
  };
}

export async function ignoreCandidates(userId: string, ids: string[]): Promise<number> {
  const { count } = await prisma.mailIntakeCandidate.updateMany({
    where: { userId, id: { in: ids }, status: { in: ["open", "failed"] } },
    data: { status: "ignored" },
  });
  return count;
}

export interface ImportResult {
  imported: number;
  proposed: number;
  failed: number;
}

/** Downloads exactly the listed mails, one connection for the lot, as a job. */
export async function startImport(
  userId: string,
  ids: string[],
  fetcher: MailFetcher = imapFetcher
): Promise<JobView> {
  const source = await prisma.mailIntakeSource.findUnique({ where: { userId } });
  if (!source) throw new AppError("No mailbox is set up", 404, "MAIL_SOURCE_NOT_FOUND");
  if (await isServiceOff(source)) {
    throw new AppError("Mail intake is switched off for this account", 409, "MAIL_INTAKE_OFF");
  }
  const rows = await prisma.mailIntakeCandidate.findMany({
    where: { userId, sourceId: source.id, id: { in: ids }, status: { in: ["open", "failed"] } },
    orderBy: { uid: "asc" },
  });
  if (rows.length === 0) {
    throw new AppError("No such candidate", 404, "MAIL_CANDIDATE_NOT_FOUND");
  }
  return startJob("mailIntake.import", userId, async (report) => {
    const result: ImportResult = { imported: 0, proposed: 0, failed: 0 };
    try {
      await fetcher.withFolder(await guardedConnection(source), async (session) => {
        for (const [index, row] of rows.entries()) {
          const outcome = await importOne(source, session, row);
          if (outcome === "proposed" || outcome === "imported") result.imported += 1;
          if (outcome === "proposed") result.proposed += 1;
          if (outcome === "failed") result.failed += 1;
          report(index + 1, rows.length);
        }
      });
    } catch (error) {
      const kind = reportedKind(source, classifyImapError(error));
      logger.warn({ operation: "mail_intake_candidate_import_failed", kind });
      // The job error's code is the source failure kind itself (`auth_failed`,
      // `folder_missing`, `unreachable`, …): the client words it like the settings card.
      throw new AppError(kind, 502);
    }
    return result;
  });
}

type SourceRow = NonNullable<Awaited<ReturnType<typeof prisma.mailIntakeSource.findUnique>>>;
type CandidateRow = NonNullable<Awaited<ReturnType<typeof prisma.mailIntakeCandidate.findUnique>>>;

async function fail(row: CandidateRow, reason: CandidateReason): Promise<"failed"> {
  await prisma.mailIntakeCandidate.update({
    where: { id: row.id },
    data: { status: "failed", reason },
  });
  return "failed";
}

async function importOne(
  source: SourceRow,
  session: MailSession,
  row: CandidateRow
): Promise<"proposed" | "imported" | "failed"> {
  if (row.uidValidity !== session.uidValidity) return fail(row, "mail_gone");
  const [header] = await session.fetchHeaders([row.uid]);
  if (!header || (row.messageId && header.messageId !== row.messageId)) {
    return fail(row, "mail_gone");
  }
  const fetched = await session.fetchSource(row.uid, DOCUMENT_SIZE_LIMITS.eml);
  if (!fetched) return fail(row, "mail_gone");
  if ("tooLarge" in fetched) return fail(row, "mail_too_large");
  const outcome = await processMail(
    { id: source.id, userId: source.userId, kind: source.kind, authservId: source.authservId },
    { uid: row.uid, uidValidity: session.uidValidity, ...fetched }
  );
  // From here the mail is the intake's: a parser failure shows in the inbox with its retry.
  await session.markProcessed(row.uid, { keepUnread: source.keepUnread });
  await prisma.mailIntakeCandidate.update({
    where: { id: row.id },
    data: { status: "imported", reason: null },
  });
  // The mail is the intake's now either way, but a pipeline failure is counted as one: the
  // inbox shows it with its reason and a retry, and the summary must not say "0 failed".
  if (outcome.status === "failed") return "failed";
  return outcome.status === "proposed" ? "proposed" : "imported";
}
