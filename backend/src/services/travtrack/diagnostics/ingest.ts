import { prisma } from "../../../db";
import { Prisma } from "../../../prisma";
import { AppError } from "../../../middleware/errorHandler";
import { payloadHash } from "../../sync/clientRef";
import { judgeEvent, type RejectReason } from "./judge";
import { DIAGNOSTICS_MAX_EVENTS_PER_ACCOUNT } from "../../../schemas/travtrackDiagnostics";

/**
 * Takes one diagnostics upload from a paired phone (spec
 * 2026-10-29-travtrack-diagnostics). Idempotent per device and `uploadId`: a
 * retry with the same content is answered from the receipt, the same id with
 * other content is refused — the phone froze that batch, so a difference is a
 * bug worth hearing about, not something to merge.
 */

export interface DiagnosticsIngestResult {
  uploadId: string;
  stored: number;
  rejected: { index: number; reason: RejectReason }[];
}

export interface DiagnosticsIngestInput {
  userId: string;
  deviceId: string;
  uploadId: string;
  device: Record<string, string>;
  events: Record<string, unknown>[];
  nowMs?: number;
}

async function replay(
  input: DiagnosticsIngestInput,
  hash: string
): Promise<{ result: DiagnosticsIngestResult; replayed: true } | null> {
  const receipt = await prisma.travTrackDiagnosticUpload.findUnique({
    where: {
      userId_deviceId_uploadId: {
        userId: input.userId,
        deviceId: input.deviceId,
        uploadId: input.uploadId,
      },
    },
  });
  if (!receipt) return null;
  if (receipt.payloadHash !== hash) {
    throw new AppError(
      "This uploadId was already used for other content",
      409,
      "RECORDING_UPLOAD_ID_REUSED"
    );
  }
  return { result: receipt.result as unknown as DiagnosticsIngestResult, replayed: true };
}

export async function ingestDiagnostics(
  input: DiagnosticsIngestInput
): Promise<{ result: DiagnosticsIngestResult; replayed: boolean }> {
  const hash = payloadHash({ device: input.device, events: input.events });
  const earlier = await replay(input, hash);
  if (earlier) return earlier;

  const nowMs = input.nowMs ?? Date.now();
  const rejected: DiagnosticsIngestResult["rejected"] = [];
  const rows: Prisma.TravTrackDiagnosticEventCreateManyInput[] = [];
  input.events.forEach((raw, index) => {
    const judged = judgeEvent(raw, nowMs);
    if (typeof judged === "string") {
      rejected.push({ index, reason: judged });
      return;
    }
    rows.push({
      userId: input.userId,
      deviceId: input.deviceId,
      t: judged.t,
      kind: judged.kind,
      data: judged.data as unknown as Prisma.InputJsonValue,
    });
  });
  const result: DiagnosticsIngestResult = {
    uploadId: input.uploadId,
    stored: rows.length,
    rejected,
  };

  try {
    await prisma.$transaction(async (tx) => {
      // The receipt first: a concurrent retry of the same id fails on the
      // unique index here, before either of them stores an event.
      await tx.travTrackDiagnosticUpload.create({
        data: {
          userId: input.userId,
          deviceId: input.deviceId,
          uploadId: input.uploadId,
          payloadHash: hash,
          device: input.device as unknown as Prisma.InputJsonValue,
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      if (rows.length > 0) await tx.travTrackDiagnosticEvent.createMany({ data: rows });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await replay(input, hash);
      if (raced) return raced;
    }
    throw error;
  }
  return { result, replayed: false };
}

/** Deletes every diagnostics row of the account. */
export async function deleteDiagnostics(userId: string): Promise<number> {
  const [events] = await prisma.$transaction([
    prisma.travTrackDiagnosticEvent.deleteMany({ where: { userId } }),
    prisma.travTrackDiagnosticUpload.deleteMany({ where: { userId } }),
  ]);
  return events.count;
}

/** Rows one prune statement removes: short statements, no 60k-row delete in one go. */
export const PRUNE_BATCH = 5_000;

async function deleteInBatches(run: () => Promise<number>): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await run();
    total += n;
    if (n < PRUNE_BATCH) return total;
  }
}

/**
 * The retention sweep: events by their instant, receipts by arrival, then
 * every account's events beyond `maxPerAccount`, oldest first. In batches of
 * `PRUNE_BATCH` (perf audit 2026-11, item 8: the single ~60k-row deleteMany
 * was one long statement and one large WAL burst).
 */
export async function pruneDiagnostics(
  retentionDays: number,
  nowMs: number = Date.now(),
  maxPerAccount: number = DIAGNOSTICS_MAX_EVENTS_PER_ACCOUNT
): Promise<{ events: number; uploads: number; overCap: number }> {
  const horizon = new Date(nowMs - retentionDays * 86_400_000);
  const events = await deleteInBatches(
    () => prisma.$executeRaw`
      DELETE FROM travtrack_diagnostic_events WHERE id IN (
        SELECT id FROM travtrack_diagnostic_events WHERE t < ${horizon} LIMIT ${PRUNE_BATCH})`
  );
  const uploads = await deleteInBatches(
    () => prisma.$executeRaw`
      DELETE FROM travtrack_diagnostic_uploads WHERE id IN (
        SELECT id FROM travtrack_diagnostic_uploads WHERE created_at < ${horizon} LIMIT ${PRUNE_BATCH})`
  );
  let overCap = 0;
  const heavy = await prisma.$queryRaw<{ user_id: string; n: bigint }[]>`
    SELECT user_id, count(*) AS n FROM travtrack_diagnostic_events
     GROUP BY user_id HAVING count(*) > ${maxPerAccount}`;
  for (const { user_id: userId, n } of heavy) {
    let excess = Number(n) - maxPerAccount;
    while (excess > 0) {
      const take = Math.min(excess, PRUNE_BATCH);
      const removed = await prisma.$executeRaw`
        DELETE FROM travtrack_diagnostic_events WHERE id IN (
          SELECT id FROM travtrack_diagnostic_events WHERE user_id = ${userId}
           ORDER BY t ASC LIMIT ${take})`;
      if (removed === 0) break;
      overCap += removed;
      excess -= removed;
    }
  }
  return { events, uploads, overCap };
}
