import { createHash, randomBytes } from "crypto";
import { createClient } from "webdav";
import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { prisma } from "../db";
import { getWebDAVSettings } from "./instanceSettingsService";
import { AppError } from "../middleware/errorHandler";
import { isServiceDisabledByAdmin } from "./externalServices/policy";
import logger from "../utils/logger";
import type { ApiErrorCode } from "../middleware/apiErrorCode";
import { classifyWebdavError, type WebdavSyncErrorCode } from "./webdavSync/errors";

type WebDAVClient = ReturnType<typeof createClient>;

/**
 * Every failure this service raises carries its HTTP status (forgejo#77).
 *
 * The routes above it pass errors straight to `errorHandler`, which reads
 * `statusCode` off the error and falls back to 500. A bare `Error('WebDAV
 * sync is not enabled')` therefore reached the admin as a server fault, at
 * error level in the log, for a condition that is nothing of the kind: the
 * operator has not switched the feature on. So: 409 for "not configured"
 * (the request is well-formed, the instance is not in a state to honour it),
 * 404 for a backup that does not exist here or on the share, 400 for a
 * backup that is not finished, and 502 for a share that answered badly —
 * that last one is the only upstream fault, and the only one that belongs
 * in the error log.
 */

/**
 * "Off means off" (forgejo#392): the admin's service-level switch stops the
 * instance backups exactly as it stops the accounts' syncs (`connectionGate`).
 */
async function assertWebdavNotSwitchedOff(): Promise<void> {
  if (await isServiceDisabledByAdmin("webdav")) {
    throw new AppError("WebDAV is switched off by the administrator", 409, "SERVICE_DISABLED");
  }
}

/**
 * Build a WebDAV client from current DB settings (with ENV fallback).
 * Throws 409 if sync is disabled or any required field is missing.
 */
async function getWebDAVClient(): Promise<{
  client: WebDAVClient;
  backupPath: string;
  target: string;
}> {
  const { enabled, url, username, password, backupPath } = await getWebDAVSettings();
  if (!enabled) {
    throw new AppError("WebDAV sync is not enabled", 409);
  }
  await assertWebdavNotSwitchedOff();
  if (!url || !username || !password) {
    throw new AppError("WebDAV is not configured", 409);
  }
  return {
    client: createClient(url, { username, password }),
    backupPath,
    target: createHash("sha256")
      .update(JSON.stringify([url.replace(/\/+$/, ""), username, backupPath]))
      .digest("hex"),
  };
}

/**
 * Turn a failure from the WebDAV client into one with a status.
 *
 * The `webdav` package rejects any HTTP >= 400 with an Error carrying
 * `status`; a file that is not on the share is its 404. Everything else —
 * a refused connection, a 500 from the share, a TLS error — is the share's
 * fault, and 502 says so. An error that already has a status passes through.
 */
function asUpstreamError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const status = (error as { status?: unknown }).status;
  if (status === 404) {
    return new AppError("Backup not found on the WebDAV share", 404, "WEBDAV_BACKUP_NOT_ON_SHARE");
  }
  // The share's own words stay in the message: "507 Insufficient Storage" is
  // what the admin has to act on, and the status alone would hide it.
  const reason = error instanceof Error ? error.message : "Unknown error";
  return new AppError(
    `WebDAV share did not answer as expected: ${reason}`,
    502,
    UPSTREAM_CODE[classifyWebdavError(error)] ?? "WEBDAV_BACKUP_SHARE_ERROR"
  );
}

/** Which stable cause the admin page words, per kind of share failure. */
const UPSTREAM_CODE: Partial<Record<WebdavSyncErrorCode, ApiErrorCode>> = {
  auth: "WEBDAV_BACKUP_AUTH",
  quota: "WEBDAV_BACKUP_QUOTA",
  tooLarge: "WEBDAV_BACKUP_QUOTA",
  timeout: "WEBDAV_BACKUP_TIMEOUT",
  unreachable: "WEBDAV_BACKUP_UNREACHABLE",
  tls: "WEBDAV_BACKUP_UNREACHABLE",
};

/**
 * Refuse early, with the request, when the share cannot be used at all:
 * switched off, or enabled with a field missing. Routes call it before they
 * start a job so these two read as the 409 they are; inside a job the same
 * refusal arrives through `asCloudJobError`.
 */
export async function assertWebdavReady(): Promise<void> {
  try {
    await getWebDAVClient();
  } catch (error) {
    throw asCloudJobError(error);
  }
}

/**
 * The error a cloud backup job ends with: every failure carries a stable code
 * (never JOB_FAILED), because the page words each cause differently and the
 * thrower's English prose must not reach a German screen.
 */
export function asCloudJobError(err: unknown): AppError {
  if (err instanceof AppError && err.code) return err;
  if (err instanceof AppError) {
    if (err.statusCode === 409 && /not enabled/i.test(err.message)) {
      return new AppError(err.message, 409, "WEBDAV_NOT_ENABLED");
    }
    if (err.statusCode === 409 && /not configured/i.test(err.message)) {
      return new AppError(err.message, 409, "WEBDAV_NOT_CONFIGURED");
    }
    if (err.statusCode === 404) return new AppError(err.message, 404, "WEBDAV_BACKUP_FILE_MISSING");
    return err;
  }
  return asUpstreamError(err);
}

/** Test WebDAV connection. */
export async function testConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const { enabled } = await getWebDAVSettings();
    if (!enabled) {
      return { success: false, message: "WebDAV sync is not enabled" };
    }

    const { client } = await getWebDAVClient();
    await client.getDirectoryContents("/");

    return { success: true, message: "WebDAV connection successful" };
  } catch (error) {
    logger.error({
      operation: "webdav_test_error",
      message: "WebDAV connection test failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/** SHA-256 of a file, streamed: an archive with photos is several GB. */
export async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** The checksum file that travels beside an uploaded archive. */
export const checksumPathOf = (remotePath: string): string => `${remotePath}.sha256`;

/** `sha256sum` format, so the admin can check an archive by hand too. */
const checksumFileBody = (sha256: string, filename: string): string => `${sha256}  ${filename}\n`;

/**
 * The SHA-256 stored beside a remote archive, or null when there is none (an
 * archive uploaded before checksums existed, or whose checksum file did not
 * make it). Absence is not an error; any other failure to READ it is, so a
 * flaky share never downgrades a verifiable download to an unverified one.
 */
async function readRemoteChecksum(
  client: WebDAVClient,
  remotePath: string
): Promise<string | null> {
  // A checksum file is ~100 bytes; a share that stalls on it must not hold the
  // job lock forever, so the read has its own deadline.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), CHECKSUM_READ_TIMEOUT_MS);
  let raw: unknown;
  try {
    raw = await client.getFileContents(checksumPathOf(remotePath), {
      format: "text",
      signal: abort.signal,
    });
  } catch (error) {
    if ((error as { status?: unknown }).status === 404) return null;
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : "";
  const match = text.length <= MAX_CHECKSUM_FILE_BYTES ? text.trim().match(CHECKSUM_LINE) : null;
  if (!match) {
    // A checksum file that EXISTS but cannot be read is not "no checksum": the
    // archive it guards may be the corrupt one, so it is refused, not waved
    // through as unverified.
    throw new AppError(
      "The checksum file beside the backup on the WebDAV share is not a SHA-256",
      502,
      "WEBDAV_DOWNLOAD_CHECKSUM_MISMATCH"
    );
  }
  return match[1].toLowerCase();
}

const CHECKSUM_READ_TIMEOUT_MS = 30_000;
const MAX_CHECKSUM_FILE_BYTES = 1024;
const CHECKSUM_LINE = /^([0-9a-f]{64})(\s|$)/i;

/** Sync a completed backup to WebDAV. */
export async function syncToCloud(backupId: string): Promise<void> {
  // The backup is looked up BEFORE the feature flag: "that backup does not
  // exist" is the more specific fact, and an unknown id should read 404
  // whether or not the operator has switched WebDAV on.
  const backup = await prisma.backup.findUnique({ where: { id: backupId } });

  if (!backup) {
    throw new AppError("Backup not found", 404);
  }

  if (backup.status !== "completed") {
    throw new AppError("Backup is not completed", 400);
  }

  if (!backup.backupPath || !fs.existsSync(backup.backupPath)) {
    throw new AppError("Backup file not found", 404);
  }

  const { client, backupPath, target } = await getWebDAVClient();
  // Hashed before the upload and outside its try: a local read failure is not
  // the share's fault and must not be reported as a 502.
  const sha256 = await sha256OfFile(backup.backupPath);

  try {
    // Ensure backup directory exists on WebDAV (ignore if it already does)
    try {
      await client.createDirectory(backupPath, { recursive: true });
    } catch {
      // Directory might already exist
    }

    const filename = path.basename(backup.backupPath);
    const remotePath = path.join(backupPath, filename).replace(/\\/g, "/");

    // Overwriting an archive must not leave the OLD checksum beside the new
    // bytes: a later download would reject a good file as corrupt. Remove it
    // first; if it cannot be removed the upload stops here, before any byte.
    try {
      await client.deleteFile(checksumPathOf(remotePath));
    } catch (error) {
      if ((error as { status?: unknown }).status !== 404) throw error;
    }

    logger.info({
      operation: "webdav_upload_start",
      message: "Uploading backup to WebDAV",
      backupId,
      remotePath,
    });

    // Streamed with an explicit length: a backup with photos is several GB, and
    // readFileSync throws ERR_FS_FILE_TOO_LARGE above 2 GiB (forgejo#354).
    const { size } = fs.statSync(backup.backupPath);
    await client.putFileContents(remotePath, fs.createReadStream(backup.backupPath), {
      overwrite: true,
      contentLength: size,
      // webdav sends no Content-Length for a Readable body (it ignores the
      // option above), so the header is set explicitly: servers that refuse
      // chunked uploads keep working.
      headers: { "Content-Length": String(size) },
    });

    // The checksum goes up AFTER the archive: a download that finds one can
    // trust that the archive it describes is complete. A failure here leaves a
    // good upload that downloads as "unverified" — logged, not fatal.
    try {
      await client.putFileContents(checksumPathOf(remotePath), checksumFileBody(sha256, filename), {
        overwrite: true,
      });
    } catch (checksumError) {
      logger.warn({
        operation: "webdav_checksum_upload_failed",
        message: "Backup uploaded but its checksum file could not be written",
        backupId,
        remotePath,
        error: checksumError instanceof Error ? checksumError.message : "Unknown error",
      });
    }

    await prisma.backup.update({
      where: { id: backupId },
      data: {
        syncedToCloud: true,
        cloudSyncAt: new Date(),
        cloudTarget: target,
        cloudPath: remotePath,
        cloudDeleteError: null,
        // A success clears the previous reason. Leaving it would show the
        // admin a red explanation next to a green tick.
        cloudSyncError: null,
      },
    });

    logger.info({
      operation: "webdav_upload_complete",
      message: "Backup uploaded to WebDAV successfully",
      backupId,
      remotePath,
    });
  } catch (error) {
    logger.error({
      operation: "webdav_upload_error",
      message: "Failed to upload backup to WebDAV",
      backupId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw asUpstreamError(error);
  }
}

/** Longest failure reason kept on the row. A share that answers with an HTML
 *  error page would otherwise put a whole document in a column the UI shows. */
const MAX_SYNC_ERROR_LENGTH = 500;

/**
 * Upload a freshly completed backup, if the operator asked for that.
 *
 * This is the caller `syncToCloud` never had. Until 2026-09-12 the only way to
 * reach it was `POST /backup/:id/sync`, and nothing called that route either —
 * no button in the admin UI, no step after `createBackup`, no step in the
 * scheduler. So no backup this application has ever taken reached a WebDAV
 * share, while the settings copy said "after each successful backup the
 * archive is uploaded" and the backup table showed a "Cloud" column that could
 * only ever read "-". Reported by a beta tester whose connection test was
 * green and whose Nextcloud stayed empty, which is exactly how it would look.
 *
 * Three properties this wrapper has and `syncToCloud` deliberately does not:
 *
 * 1. **It never throws.** A backup that is on local disk is a real backup. An
 *    upload that fails afterwards must not turn it into a failed one, and must
 *    not fail the import that took it as a safety copy.
 * 2. **A disabled feature is silent.** `syncToCloud` answers 409 for "not
 *    enabled", which is the right answer to an explicit request and the wrong
 *    thing to write to the error log every night on the majority of instances
 *    that never configured WebDAV.
 * 3. **A failure is recorded where the admin looks.** `enabled` but incomplete
 *    settings are NOT filtered out here on purpose: someone who ticked the box
 *    and left the URL empty meant to sync, and "WebDAV is not configured"
 *    beside their backup is the sentence that tells them why it did not.
 */
export async function syncToCloudIfEnabled(backupId: string): Promise<void> {
  try {
    const { enabled } = await getWebDAVSettings();
    if (!enabled || (await isServiceDisabledByAdmin("webdav"))) {
      logger.debug({
        operation: "webdav_autosync_skip",
        message: "WebDAV sync is not enabled, backup stays local",
        backupId,
      });
      return;
    }
  } catch (error) {
    // Reading the settings is not the backup's problem to solve, but it does
    // mean we cannot tell whether an upload was wanted — so say so rather than
    // silently deciding it was not.
    logger.error({
      operation: "webdav_autosync_settings_error",
      message: "Could not read WebDAV settings, skipping automatic upload",
      backupId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return;
  }

  try {
    await syncToCloud(backupId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    logger.error({
      operation: "webdav_autosync_error",
      message: "Automatic upload of a completed backup failed",
      backupId,
      error: reason,
    });
    await prisma.backup
      .update({
        where: { id: backupId },
        data: { cloudSyncError: reason.slice(0, MAX_SYNC_ERROR_LENGTH) },
      })
      .catch((updateError: unknown) => {
        logger.error({
          operation: "webdav_autosync_error_persist_failed",
          message: "Could not record why the automatic upload failed",
          backupId,
          error: updateError instanceof Error ? updateError.message : "Unknown error",
        });
      });
  }
}

/** List backups available on the remote WebDAV share. */
export async function listCloudBackups(): Promise<
  Array<{ name: string; size: number; lastModified: Date }>
> {
  const { client, backupPath } = await getWebDAVClient();

  try {
    // Ensure directory exists
    try {
      await client.createDirectory(backupPath, { recursive: true });
    } catch {
      // Directory might already exist
    }

    const items = await client.getDirectoryContents(backupPath);

    interface WebDAVItem {
      type: string;
      basename?: string;
      size?: number;
      lastmod?: string;
    }

    const itemsArray: WebDAVItem[] = Array.isArray(items)
      ? (items as WebDAVItem[])
      : (items as { data?: WebDAVItem[] }).data || [];

    return itemsArray
      .filter((item) => item.type === "file" && item.basename?.endsWith(".tar.gz"))
      .map((item) => ({
        name: item.basename || "",
        size: item.size || 0,
        lastModified: item.lastmod ? new Date(item.lastmod) : new Date(),
      }));
  } catch (error) {
    logger.error({
      operation: "webdav_list_error",
      message: "Failed to list backups from WebDAV",
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw asUpstreamError(error);
  }
}

/**
 * The body length a response promised, or null when it promised none we can
 * compare against: no header, an unparsable one, or a content-encoding (the
 * client hands us decoded bytes, so the wire length no longer applies).
 */
export function declaredBodyLength(headers: { get(name: string): string | null }): number | null {
  const encoding = headers.get("content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity") return null;
  const raw = headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/** Longest silence tolerated while a backup streams down from the share. */
const DOWNLOAD_STALL_MS = 60_000;

/** What a finished download proved about the file it left on disk. */
export interface CloudDownloadResult {
  size: number;
  sha256: string;
  /** True when the bytes matched a checksum stored beside the upload; false
   *  when the archive predates checksums and was accepted on its size alone. */
  verified: boolean;
  /** Hash of the share's endpoint, account and folder, as recorded at upload. */
  target: string;
  remotePath: string;
}

/**
 * Download a backup file from the remote WebDAV share to local disk.
 *
 * The file only reaches `localPath` once it is complete (Content-Length) and,
 * when the share holds a checksum for it, matches that checksum; otherwise the
 * side file is deleted and the call throws.
 */
export async function downloadFromCloud(
  backupName: string,
  localPath: string,
  onProgress?: (done: number, total: number) => void
): Promise<CloudDownloadResult> {
  const { client, backupPath, target } = await getWebDAVClient();

  try {
    const remotePath = path.join(backupPath, backupName).replace(/\\/g, "/");
    const expectedSha = await readRemoteChecksum(client, remotePath);

    logger.info({
      operation: "webdav_download_start",
      message: "Downloading backup from WebDAV",
      remotePath,
      localPath,
    });

    // Stream into a side file and rename on success, so a dropped connection
    // never leaves a truncated archive under the real name (forgejo#354).
    // Unique per call: two parallel downloads of one name must not share it.
    const partPath = `${localPath}.${randomBytes(6).toString("hex")}.part`;
    let result: CloudDownloadResult;
    // The response headers arrive through the callback; Content-Length is the
    // only completeness signal the body itself never gives (a body cut short
    // by the peer ends the stream without an error).
    let expectedBytes: number | null = null;
    const source = client.createReadStream(remotePath, {
      callback: (response) => {
        expectedBytes = declaredBodyLength(response.headers);
      },
    });
    let receivedBytes = 0;
    const hash = createHash("sha256");
    source.on("data", (chunk: Buffer | string) => {
      receivedBytes += Buffer.byteLength(chunk);
      hash.update(chunk);
      if (expectedBytes) onProgress?.(receivedBytes, expectedBytes);
    });
    // webdav pipes the HTTP body into this stream without forwarding its
    // errors, so a connection that dies mid-body would hang forever: a stall
    // watchdog turns silence into a failure.
    let stall: NodeJS.Timeout | undefined;
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(
        () => source.destroy(new Error("download stalled: no data received")),
        DOWNLOAD_STALL_MS
      );
    };
    arm();
    source.on("data", arm);
    try {
      await pipeline(source, fs.createWriteStream(partPath));
      // webdav delivers the headers callback through setTimeout(0), which can
      // land after a short body has already ended. Timers fire in order, so one
      // more tick guarantees the callback has run before the comparison.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (expectedBytes !== null && receivedBytes !== expectedBytes) {
        throw new AppError(
          `Backup download from the WebDAV share was cut short: received ${receivedBytes} of ${expectedBytes} bytes`,
          502,
          "WEBDAV_DOWNLOAD_TRUNCATED"
        );
      }
      const sha256 = hash.digest("hex");
      if (expectedSha !== null && sha256 !== expectedSha) {
        throw new AppError(
          "Backup downloaded from the WebDAV share does not match its stored checksum",
          502,
          "WEBDAV_DOWNLOAD_CHECKSUM_MISMATCH"
        );
      }
      fs.renameSync(partPath, localPath);
      result = { size: receivedBytes, sha256, verified: expectedSha !== null, target, remotePath };
    } catch (streamError) {
      fs.rmSync(partPath, { force: true });
      throw streamError;
    } finally {
      clearTimeout(stall);
    }

    logger.info({
      operation: "webdav_download_complete",
      message: "Backup downloaded from WebDAV successfully",
      remotePath,
      localPath,
      verified: result.verified,
    });
    return result;
  } catch (error) {
    logger.error({
      operation: "webdav_download_error",
      message: "Failed to download backup from WebDAV",
      backupName,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw asUpstreamError(error);
  }
}

/** Delete exactly the object we uploaded. A changed target is never guessed. */
export async function deleteCloudBackup(backup: {
  id: string;
  cloudTarget?: string | null;
  cloudPath?: string | null;
}): Promise<void> {
  try {
    const { client, backupPath, target } = await getWebDAVClient();
    const remote = backup.cloudPath;
    if (
      !remote ||
      !backup.cloudTarget ||
      backup.cloudTarget !== target ||
      path.posix.dirname(remote) !== (path.posix.normalize(backupPath).replace(/\/$/, "") || "/") ||
      !/^backup-[a-zA-Z0-9._-]+\.tar\.gz$/.test(path.posix.basename(remote))
    ) {
      throw new AppError(
        "Remote backup target is unknown or changed; upload this backup again to record its current target",
        409,
        "REMOTE_TARGET_UNKNOWN"
      );
    }
    try {
      await client.deleteFile(remote);
    } catch (error) {
      // A retry after a lost DELETE response must still be able to finish.
      if ((error as { status?: number }).status !== 404) throw error;
    }
    // The checksum file goes with its archive; a leftover one is harmless, so
    // its failure never blocks the delete the admin asked for.
    try {
      await client.deleteFile(checksumPathOf(remote));
    } catch (error) {
      if ((error as { status?: number }).status !== 404) {
        logger.warn({
          operation: "webdav_checksum_delete_failed",
          message: "Backup deleted from the share but its checksum file could not be removed",
          remote,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  } catch (error) {
    // A 409 here is also "WebDAV not enabled/configured": without settings the
    // object cannot be named either, so it carries the same code.
    const targetUnknown = error instanceof AppError && error.statusCode === 409;
    await prisma.backup.update({
      where: { id: backup.id },
      data: { cloudDeleteError: targetUnknown ? "REMOTE_TARGET_UNKNOWN" : "REMOTE_DELETE_FAILED" },
    });
    if (targetUnknown) throw new AppError(error.message, 409, "REMOTE_TARGET_UNKNOWN");
    throw asUpstreamError(error);
  }
}
