import fs from "fs";
import path from "path";
import logger from "../utils/logger";
import { LogCleanupResult } from "../shared/logContract";
import { getLogDir, parseLogFileName } from "../utils/logging/logFiles";
import { openStreamNames } from "../utils/logging/fileStreams";
import { getLoggingConfig } from "./loggingConfig";

/**
 * Log retention — the ONLY code that deletes log files.
 *
 * The admin page promised "older logs are deleted automatically" while the
 * deletion ran only when someone pressed the cleanup button; the beta held 69
 * files going back five months under a seven-day setting. Now the same sweep
 * runs daily and once at boot (`jobs/logRetentionScheduler.ts`), and the
 * button calls it too.
 *
 * Two rules, both from the admin settings:
 *  - a file last written more than `logRetentionDays` ago goes;
 *  - per stream, at most `maxLogFiles` rotated copies are kept, newest first.
 *
 * rotating-file-stream is given no `maxFiles` (see `fileStreams.ts`), so there
 * is no second deleter with its own history file to disagree with this one.
 * A file a live stream is writing is never deleted: on Linux the stream would
 * go on writing into an unlinked inode, and on Windows the unlink fails.
 */

interface Candidate {
  filename: string;
  stream: string;
  rotated: boolean;
  size: number;
  mtimeMs: number;
}

async function listCandidates(dir: string): Promise<Candidate[]> {
  if (!fs.existsSync(dir)) return [];
  const names = await fs.promises.readdir(dir);
  const out: Candidate[] = [];
  for (const filename of names) {
    const parsed = parseLogFileName(filename);
    if (!parsed) continue;
    try {
      const stats = await fs.promises.stat(path.join(dir, filename));
      out.push({ filename, ...parsed, size: stats.size, mtimeMs: stats.mtimeMs });
    } catch {
      // Gone between readdir and stat.
    }
  }
  return out;
}

/** Which files the two rules condemn. Pure, so the policy is testable alone. */
export function selectExpiredLogFiles(
  files: ReadonlyArray<Omit<Candidate, "size">>,
  policy: { retentionDays: number; maxRotatedPerStream: number; now: number },
  openStreams: ReadonlySet<string>
): Set<string> {
  const cutoff = policy.now - policy.retentionDays * 24 * 60 * 60 * 1000;
  const expired = new Set<string>();
  const rotatedByStream = new Map<string, Array<Omit<Candidate, "size">>>();

  for (const file of files) {
    const liveFile = !file.rotated && openStreams.has(file.stream);
    if (liveFile) continue;
    if (file.mtimeMs < cutoff) expired.add(file.filename);
    if (file.rotated) {
      rotatedByStream.set(file.stream, [...(rotatedByStream.get(file.stream) ?? []), file]);
    }
  }
  for (const rotated of rotatedByStream.values()) {
    [...rotated]
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(Math.max(0, policy.maxRotatedPerStream))
      .forEach((file) => expired.add(file.filename));
  }
  return expired;
}

export async function enforceLogRetention(now: number = Date.now()): Promise<LogCleanupResult> {
  const config = await getLoggingConfig();
  const dir = getLogDir();
  const files = await listCandidates(dir);
  const expired = selectExpiredLogFiles(
    files,
    { retentionDays: config.logRetentionDays, maxRotatedPerStream: config.maxLogFiles, now },
    openStreamNames()
  );

  let deletedCount = 0;
  let freedBytes = 0;
  let failedCount = 0;
  for (const file of files) {
    if (!expired.has(file.filename)) continue;
    try {
      await fs.promises.unlink(path.join(dir, file.filename));
      deletedCount++;
      freedBytes += file.size;
    } catch (error) {
      failedCount++;
      logger.warn({
        operation: "log_retention_delete_failed",
        error: { code: (error as NodeJS.ErrnoException).code },
      });
    }
  }

  const result: LogCleanupResult = {
    deletedCount,
    freedBytes,
    failedCount,
    retentionDays: config.logRetentionDays,
  };
  logger.info({ operation: "log_retention_completed", context: result });
  return result;
}
