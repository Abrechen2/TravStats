/**
 * "Postfach durchsuchen": a one-off walk over a whole personal folder (or a
 * date range) that lists the booking mails probably missing in TravStats.
 *
 * Headers only. Every UID is judged on its ENVELOPE (batched UID FETCH), by the
 * same pre-filter as the live intake; a private mail leaves nothing behind but
 * the skipped count. A booking mail already known (its reference in an entry,
 * its Message-ID taken) is counted as matched and not listed. The rest becomes a
 * candidate row holding header fields only — the mail is downloaded when, and
 * only when, the user imports it (`candidates.ts`).
 *
 * The scan runs as a job (the client polls), is cancellable, and resumes after a
 * restart from its cursor: the row says where it got to, and a "running" row no
 * process holds is an interrupted one.
 */
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import { startJob, type JobView } from "../jobs/jobRegistry";
import { classifyImapError } from "./errors";
import { imapFetcher, type MailFetcher, type MailSession } from "./mailFetcher";
import { guardedConnection, isServiceOff, reportedKind } from "./runSource";
import { buildRules, judge } from "./prefilter";
import { loadKnown, matchCandidate, type Known } from "./candidateMatch";

/** UIDs per header FETCH during a scan. */
export const SCAN_BATCH = 500;
/** Breathing room between two header batches, so a scan never hogs the provider. */
export const SCAN_PAUSE_MS = 100;

export type ScanStatus = "running" | "done" | "cancelled" | "interrupted" | "failed";

export interface ScanView {
  status: ScanStatus;
  since: string | null;
  before: string | null;
  total: number;
  scanned: number;
  skipped: number;
  matched: number;
  candidates: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const active = new Map<string, AbortController>();

type ScanRow = NonNullable<Awaited<ReturnType<typeof prisma.mailIntakeScan.findUnique>>>;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function statusOf(row: ScanRow): ScanStatus {
  // A row that says running but that no process holds died with a restart.
  if (row.status === "running" && !active.has(row.sourceId)) return "interrupted";
  return row.status as ScanStatus;
}

export function scanViewOf(row: ScanRow): ScanView {
  return {
    status: statusOf(row),
    since: iso(row.since),
    before: iso(row.before),
    total: row.total,
    scanned: row.scanned,
    skipped: row.skipped,
    matched: row.matched,
    candidates: row.candidates,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    finishedAt: iso(row.finishedAt),
  };
}

async function personalSource(userId: string) {
  const source = await prisma.mailIntakeSource.findUnique({ where: { userId } });
  if (!source) throw new AppError("No mailbox is set up", 404, "MAIL_SOURCE_NOT_FOUND");
  if (await isServiceOff(source)) {
    throw new AppError("Mail intake is switched off for this account", 409, "MAIL_INTAKE_OFF");
  }
  return source;
}

export async function getScan(userId: string): Promise<ScanView | null> {
  const row = await prisma.mailIntakeScan.findFirst({ where: { userId } });
  return row ? scanViewOf(row) : null;
}

export interface ScanRequest {
  since?: Date | null;
  before?: Date | null;
  /** Continue an interrupted or cancelled scan from its cursor instead of starting over. */
  resume?: boolean;
}

/** Starts (or resumes) the scan as a job. One scan per source at a time. */
export async function startScan(
  userId: string,
  request: ScanRequest,
  fetcher: MailFetcher = imapFetcher,
  pauseMs = SCAN_PAUSE_MS
): Promise<JobView> {
  const source = await personalSource(userId);
  if (active.has(source.id)) {
    throw new AppError("A mailbox scan is already running", 409, "MAIL_SCAN_RUNNING");
  }
  const previous = await prisma.mailIntakeScan.findUnique({ where: { sourceId: source.id } });
  const resume = !!request.resume && !!previous && statusOf(previous) !== "done";
  const fresh = {
    status: "running",
    since: request.since ?? null,
    before: request.before ?? null,
    uidValidity: null,
    cursorUid: 0,
    total: 0,
    scanned: 0,
    skipped: 0,
    matched: 0,
    candidates: 0,
    error: null,
    startedAt: new Date(),
    finishedAt: null,
  };
  const row = resume
    ? await prisma.mailIntakeScan.update({
        where: { id: previous!.id },
        data: { status: "running", error: null, finishedAt: null },
      })
    : await prisma.mailIntakeScan.upsert({
        where: { sourceId: source.id },
        create: { ...fresh, sourceId: source.id, userId },
        update: fresh,
      });
  const controller = new AbortController();
  active.set(source.id, controller);
  return startJob("mailIntake.scan", userId, async (report) => {
    try {
      return await runScan(row.id, fetcher, controller.signal, report, pauseMs);
    } finally {
      active.delete(source.id);
    }
  });
}

/** Stops a running scan after its current batch; an interrupted one is simply marked cancelled. */
export async function cancelScan(userId: string): Promise<void> {
  const row = await prisma.mailIntakeScan.findFirst({ where: { userId } });
  if (!row) return;
  const controller = active.get(row.sourceId);
  if (controller) {
    controller.abort();
    return;
  }
  if (row.status === "running") {
    await prisma.mailIntakeScan.update({
      where: { id: row.id },
      data: { status: "cancelled", finishedAt: new Date() },
    });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runScan(
  scanId: string,
  fetcher: MailFetcher,
  signal: AbortSignal,
  report: (done: number, total: number) => void,
  pauseMs: number
): Promise<ScanView> {
  const scan = await prisma.mailIntakeScan.findUniqueOrThrow({ where: { id: scanId } });
  const source = await prisma.mailIntakeSource.findUniqueOrThrow({ where: { id: scan.sourceId } });
  const senders = await prisma.mailIntakeSender.findMany({
    where: { userId: scan.userId },
    select: { address: true },
  });
  const rules = buildRules(
    source,
    senders.map((s) => s.address)
  );
  const known = await loadKnown(scan.userId);
  let final: Partial<ScanRow> = {};
  try {
    const connection = await guardedConnection(source);
    final = await fetcher.withFolder(connection, (session) =>
      walk(scan, session, { rules, known, signal, report, pauseMs })
    );
  } catch (error) {
    const kind = reportedKind(source, classifyImapError(error));
    logger.warn({ operation: "mail_intake_scan_failed", sourceId: source.id, kind });
    final = { status: "failed", error: kind };
  }
  const row = await prisma.mailIntakeScan.update({
    where: { id: scanId },
    data: { ...final, finishedAt: new Date() },
  });
  return scanViewOf(row);
}

interface WalkContext {
  rules: ReturnType<typeof buildRules>;
  known: Known;
  signal: AbortSignal;
  report: (done: number, total: number) => void;
  pauseMs: number;
}

async function walk(
  scan: ScanRow,
  session: MailSession,
  ctx: WalkContext
): Promise<Partial<ScanRow>> {
  // A changed UIDVALIDITY makes the cursor meaningless: start the range over.
  const sameFolder = scan.uidValidity === null || scan.uidValidity === session.uidValidity;
  const counters = sameFolder
    ? {
        cursorUid: scan.cursorUid,
        scanned: scan.scanned,
        skipped: scan.skipped,
        matched: scan.matched,
        candidates: scan.candidates,
      }
    : { cursorUid: 0, scanned: 0, skipped: 0, matched: 0, candidates: 0 };
  const uids = (await session.searchUids({ since: scan.since, before: scan.before })).filter(
    (uid) => uid > counters.cursorUid
  );
  const total = counters.scanned + uids.length;
  await prisma.mailIntakeScan.update({
    where: { id: scan.id },
    data: { ...counters, total, uidValidity: session.uidValidity },
  });
  ctx.report(counters.scanned, total);

  for (let i = 0; i < uids.length; i += SCAN_BATCH) {
    if (ctx.signal.aborted) return { status: "cancelled" };
    const batch = uids.slice(i, i + SCAN_BATCH);
    const headers = await session.fetchHeaders(batch);
    for (const header of headers) {
      const verdict = judge(header, ctx.rules);
      if (!verdict.take) {
        counters.skipped += 1;
        continue;
      }
      const match = matchCandidate(header, verdict, ctx.known);
      if (match === "reference" || match === "message") {
        counters.matched += 1;
        continue;
      }
      if (await keepCandidate(scan, session.uidValidity, header, verdict, match)) {
        counters.candidates += 1;
      }
    }
    counters.scanned += batch.length;
    counters.cursorUid = batch[batch.length - 1];
    await prisma.mailIntakeScan.update({ where: { id: scan.id }, data: counters });
    ctx.report(counters.scanned, total);
    if (ctx.pauseMs > 0 && i + SCAN_BATCH < uids.length) await sleep(ctx.pauseMs);
  }
  return { status: "done" };
}

/** Stores a candidate unless this mail (same UID, or same Message-ID) is listed or ignored already. */
async function keepCandidate(
  scan: ScanRow,
  uidValidity: string,
  header: import("./prefilter").HeaderInfo,
  verdict: import("./prefilter").Verdict,
  match: "likely_present" | null
): Promise<boolean> {
  const existing = await prisma.mailIntakeCandidate.findFirst({
    where: {
      sourceId: scan.sourceId,
      OR: [
        { uidValidity, uid: header.uid },
        ...(header.messageId ? [{ messageId: header.messageId }] : []),
      ],
    },
    select: { id: true },
  });
  if (existing) return false;
  await prisma.mailIntakeCandidate.create({
    data: {
      sourceId: scan.sourceId,
      userId: scan.userId,
      uidValidity,
      uid: header.uid,
      messageId: header.messageId,
      receivedAt: header.date,
      fromAddress: header.from,
      subject: header.subject?.slice(0, 500) ?? null,
      brand: verdict.brand,
      guessedDomain: verdict.kind,
      matchHint: match,
    },
  });
  return true;
}

/** Test seam: forget the in-memory handles (what a restart does). */
export function forgetActiveScans(): void {
  active.clear();
}
