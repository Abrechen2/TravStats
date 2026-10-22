import path from "path";
import { gzipSync } from "zlib";
import { createClient } from "webdav";

import { prisma } from "../../db";
import { decryptApiKey } from "../../utils/encryption";
import logger from "../../utils/logger";
import { buildAccountExport } from "../export/allDataExport";
import { getInstanceSettings } from "../instanceSettingsService";
import { classifyWebdavError, WebdavSyncError, type WebdavSyncErrorCode } from "./errors";
import { guardedAgents, normalizeWebdavUrl, type TargetPolicy } from "./targetPolicy";

/**
 * One run of an account's WebDAV sync (forgejo#321): its full data export,
 * gzipped, uploaded as a new file; then all but the newest `keepVersions` of
 * OUR files in that folder deleted. Every run, scheduled or clicked, ends in
 * a recorded result on the row — the reason included — because a sync that
 * fails at 05:15 has nobody watching but the settings page.
 */

export type WebdavRunStatus = "ok" | "partial" | "failed";

export interface WebdavRunResult {
  status: WebdavRunStatus;
  /** Null on "ok"; the retention failure on "partial"; the cause on "failed". */
  errorCode: WebdavSyncErrorCode | null;
  fileName: string | null;
  sizeBytes: number | null;
  /** Older exports removed by the retention step. */
  deleted: number;
}

/** Our file names, and nothing else in the folder: retention deletes only these. */
export const EXPORT_FILE_PATTERN = /^travstats-export-\d{8}T\d{6}Z\.json\.gz$/;

/** How long one upload may take before it counts as a timeout. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
/** How long a listing, a folder creation or a delete may take. */
const REQUEST_TIMEOUT_MS = 60_000;

const running = new Set<string>();

/** `travstats-export-20261022T051500Z.json.gz` — sortable by name. */
export function exportFileName(at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
  return `travstats-export-${stamp}.json.gz`;
}

/** Whether a run of this account's sync is in progress in this process. */
export function isWebdavSyncRunning(userId: string): boolean {
  return running.has(userId);
}

interface ResolvedTarget {
  url: string;
  username: string;
  password: string;
  remotePath: string;
  keepVersions: number;
  policy: TargetPolicy;
}

async function resolveTarget(userId: string): Promise<ResolvedTarget> {
  const [row, user] = await Promise.all([
    prisma.userWebdavSync.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }),
  ]);
  if (!row || !user || !row.enabled || !row.url || !row.username || !row.passwordEncrypted) {
    throw new WebdavSyncError("notConfigured");
  }
  const password = decryptApiKey(row.passwordEncrypted);
  if (!password) throw new WebdavSyncError("notConfigured");
  // Read now, not when the URL was saved: a demoted account loses a LAN target.
  const policy: TargetPolicy = { allowPrivate: user.isAdmin };
  return {
    url: normalizeWebdavUrl(row.url, policy),
    username: row.username,
    password,
    remotePath: row.remotePath,
    keepVersions: row.keepVersions,
    policy,
  };
}

type Client = ReturnType<typeof createClient>;

/** Create the folder; "it already exists" is the normal answer and is fine. */
async function ensureFolder(client: Client, remotePath: string): Promise<void> {
  try {
    await client.createDirectory(remotePath, {
      recursive: true,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // A refused password or a dead share answers here first: say so now
    // rather than as whatever the upload would then fail with.
    const code = classifyWebdavError(error);
    if (["auth", "unreachable", "timeout", "tls", "blockedTarget"].includes(code)) throw error;
  }
}

/** Delete all but the newest `keep` of our exports; returns how many went. */
async function pruneOldExports(client: Client, remotePath: string, keep: number): Promise<number> {
  const listing = (await client.getDirectoryContents(remotePath, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  } as never)) as unknown;
  const items = (Array.isArray(listing) ? listing : []) as Array<{
    type?: string;
    basename?: string;
  }>;
  const ours = items
    .filter((i) => i.type === "file" && EXPORT_FILE_PATTERN.test(i.basename ?? ""))
    .map((i) => i.basename as string)
    .sort()
    .reverse();
  let deleted = 0;
  for (const name of ours.slice(keep)) {
    await client.deleteFile(path.posix.join(remotePath, name), {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    deleted += 1;
  }
  return deleted;
}

async function record(userId: string, result: WebdavRunResult, at: Date): Promise<void> {
  await prisma.userWebdavSync.update({
    where: { userId },
    data: {
      lastAttemptAt: at,
      lastStatus: result.status,
      lastErrorCode: result.errorCode,
      ...(result.status === "failed"
        ? {}
        : { lastSuccessAt: at, lastFileName: result.fileName, lastSizeBytes: result.sizeBytes }),
    },
  });
}

async function upload(userId: string, target: ResolvedTarget, at: Date): Promise<WebdavRunResult> {
  const { instanceName } = await getInstanceSettings();
  const data = await buildAccountExport(userId, instanceName);
  if (!data) throw new WebdavSyncError("notConfigured");
  const body = gzipSync(Buffer.from(JSON.stringify(data), "utf8"));
  const fileName = exportFileName(at);

  const client = createClient(target.url, {
    username: target.username,
    password: target.password,
    ...guardedAgents(target.policy),
  });
  await ensureFolder(client, target.remotePath);
  await client.putFileContents(path.posix.join(target.remotePath, fileName), body, {
    overwrite: false,
    contentLength: body.length,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });

  // The export is on the share; a failed clean-up must not turn that into a
  // failure, nor be swallowed — it is reported as "partial" with its cause.
  try {
    const deleted = await pruneOldExports(client, target.remotePath, target.keepVersions);
    return { status: "ok", errorCode: null, fileName, sizeBytes: body.length, deleted };
  } catch (error) {
    const errorCode = classifyWebdavError(error);
    logger.warn({ operation: "webdav_user_sync_retention_failed", userId, code: errorCode });
    return { status: "partial", errorCode, fileName, sizeBytes: body.length, deleted: 0 };
  }
}

/**
 * Run the sync for one account and record the outcome. Resolves with the
 * result for "ok" and "partial"; throws a `WebdavSyncError` for "failed",
 * AFTER recording it — so a clicked run's job fails with the same code the
 * page then shows as the last result.
 */
export async function runWebdavSync(userId: string): Promise<WebdavRunResult> {
  if (running.has(userId)) throw new WebdavSyncError("alreadyRunning");
  running.add(userId);
  const at = new Date();
  try {
    let target: ResolvedTarget;
    try {
      target = await resolveTarget(userId);
    } catch (error) {
      const code = classifyWebdavError(error);
      // Without a row there is nowhere to record; "not configured" is the answer.
      const exists = await prisma.userWebdavSync.count({ where: { userId } });
      if (exists) {
        await record(userId, failed(code), at);
      }
      throw new WebdavSyncError(code);
    }
    try {
      const result = await upload(userId, target, at);
      await record(userId, result, at);
      logger.info({
        operation: "webdav_user_sync_done",
        userId,
        status: result.status,
        sizeBytes: result.sizeBytes,
        deleted: result.deleted,
      });
      return result;
    } catch (error) {
      const code = classifyWebdavError(error);
      logger.warn({
        operation: "webdav_user_sync_failed",
        userId,
        code,
        error: error instanceof Error ? error.message : String(error),
      });
      await record(userId, failed(code), at);
      throw new WebdavSyncError(code);
    }
  } finally {
    running.delete(userId);
  }
}

function failed(code: WebdavSyncErrorCode): WebdavRunResult {
  return { status: "failed", errorCode: code, fileName: null, sizeBytes: null, deleted: 0 };
}
