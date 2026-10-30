import { connectionGate } from "../externalServices/policy";
import { createHash } from "crypto";
import path from "path";
import { createReadStream } from "fs";
import { mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { createClient } from "webdav";

import { prisma } from "../../db";
import { decryptApiKey, encryptionKeyFingerprint } from "../../utils/encryption";
import logger from "../../utils/logger";
import { buildAccountExport } from "../export/allDataExport";
import { writeJsonGzipFile } from "../export/jsonStream";
import { getInstanceSettings } from "../instanceSettingsService";
import { classifyWebdavError, WebdavSyncError, type WebdavSyncErrorCode } from "./errors";
import { pruneOwnExports, recordUpload } from "./retention";
import { guardedAgents, normalizeWebdavUrl, type TargetPolicy } from "./targetPolicy";

/**
 * One run of an account's WebDAV sync (forgejo#321): its full data export,
 * gzipped, uploaded as a new file; then all but the newest `keepVersions` of
 * THIS account's files in that folder deleted. Every run, scheduled or clicked, ends in
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

/**
 * Which account on which instance wrote an export: twelve hex digits of a
 * hash over the instance's encryption-key fingerprint and the user id. Two
 * accounts, or the same account restored onto a second instance, that sync
 * into one folder must never count — and so delete — each other's files
 * (Codex review). Hashed so the name carries neither the id nor the user
 * name in clear; stable for as long as the instance can read the stored
 * password at all, since that needs the same key.
 */
export function exportOwnerTag(userId: string): string {
  return createHash("sha256")
    .update(`travstats-webdav-owner:${encryptionKeyFingerprint()}:${userId}`)
    .digest("hex")
    .slice(0, 12);
}

/** This owner's file names, and nothing else in the folder: retention deletes only these. */
export function ownExportPattern(tag: string): RegExp {
  return new RegExp(`^travstats-export-${tag}-\\d{8}T\\d{6}Z\\.json\\.gz$`);
}

/** How long one upload may take before it counts as a timeout. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
/** How long a listing, a folder creation or a delete may take. */
const REQUEST_TIMEOUT_MS = 60_000;
/**
 * How long a whole run may take, export build and every request included.
 * A share that never answers — or a library call that ignores its signal —
 * must not hold the account "running" forever and stall the nightly sweep,
 * which syncs one account after another (Codex review).
 */
const RUN_DEADLINE_MS = 15 * 60_000;
/** Of that, how long the clean-up after a stored upload may take. */
const RETENTION_BUDGET_MS = 2 * 60_000;

/**
 * How long, after the deadline, a run still waits for its result to be
 * written before it returns anyway. The write itself carries on, guarded so
 * it cannot overwrite a newer run's result (see `record`).
 */
const RECORD_GRACE_MS = 30_000;

/** The account's lock, held by one run's token so a late run frees only its own. */
const running = new Map<string, symbol>();

/** `travstats-export-<tag>-20261022T051500Z.json.gz` — sortable by name within one owner. */
export function exportFileName(at: Date, tag: string): string {
  const stamp = at
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
  return `travstats-export-${tag}-${stamp}.json.gz`;
}

/** A request's signal: its own timeout, or the run's deadline, whichever comes first. */
function requestSignal(deadline: AbortSignal, ms: number): AbortSignal {
  return AbortSignal.any([deadline, AbortSignal.timeout(ms)]);
}

/**
 * `work`, or the signal's reason the moment it aborts — whether or not the
 * work itself listens. The signals handed to each request cancel the real
 * I/O; this is the backstop for a call that does not pass them on.
 */
function untilAborted<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
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
  /** The names this account recorded uploading, newest first. */
  history: string[];
}

async function resolveTarget(userId: string): Promise<ResolvedTarget> {
  const [row, user] = await Promise.all([
    prisma.userWebdavSync.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }),
  ]);
  if (!row || !user || !row.enabled || !row.url || !row.username || !row.passwordEncrypted) {
    throw new WebdavSyncError("notConfigured");
  }
  // Switched off by the admin, forbidden for accounts, or off for this account
  // (external-services policy, forgejo#392): the sync does not run, however it
  // was started — the scheduler and "Jetzt abgleichen" both land here.
  const gate = await connectionGate("webdav", userId);
  if (gate.off || !gate.accountMayConnect) throw new WebdavSyncError("notConfigured");
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
    history: row.uploadedFiles,
  };
}

type Client = ReturnType<typeof createClient>;

/** Create the folder; "it already exists" is the normal answer and is fine. */
/**
 * One MKCOL per level, top down, each with the run's cancellation. Not the
 * library's `recursive: true`: that probes every level with a PROPFIND that
 * does not forward the signal, so a share that never answers it hangs the run.
 */
async function ensureFolder(
  client: Client,
  remotePath: string,
  deadline: AbortSignal
): Promise<void> {
  const segments = remotePath.split("/").filter(Boolean);
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const folder = `/${segments.slice(0, depth).join("/")}`;
    try {
      await client.createDirectory(folder, {
        signal: requestSignal(deadline, REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // A refused password or a dead share answers here first: say so now
      // rather than as whatever the upload would then fail with. Anything
      // else — 405 "already there" above all — leaves the upload to tell.
      const code = classifyWebdavError(error);
      if (["auth", "unreachable", "timeout", "tls", "blockedTarget"].includes(code)) throw error;
    }
  }
}

/**
 * Mark this run as the account's latest attempt — only if no newer one has
 * claimed it — and answer whether it did. Every later write of the run is
 * conditioned on still being that attempt.
 */
async function claim(userId: string, at: Date): Promise<boolean> {
  const { count } = await prisma.userWebdavSync.updateMany({
    where: { userId, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: at } }] },
    data: { lastAttemptAt: at },
  });
  return count > 0;
}

/**
 * Write the run's result, unless a newer run has claimed the row since: a
 * run that timed out because the database hung must not land its result
 * over the next run's when the database wakes (Codex review). Waits at most
 * RECORD_GRACE_MS; past that the write carries on alone, still guarded.
 */
async function record(
  userId: string,
  result: WebdavRunResult,
  at: Date,
  history?: string[]
): Promise<void> {
  const write = prisma.userWebdavSync.updateMany({
    where: { userId, lastAttemptAt: at },
    data: {
      ...(history ? { uploadedFiles: history } : {}),
      lastStatus: result.status,
      lastErrorCode: result.errorCode,
      ...(result.status === "failed"
        ? {}
        : { lastSuccessAt: at, lastFileName: result.fileName, lastSizeBytes: result.sizeBytes }),
    },
  });
  try {
    await untilAborted(AbortSignal.timeout(RECORD_GRACE_MS), write);
  } catch (error) {
    logger.warn({
      operation: "webdav_user_sync_record_failed",
      userId,
      status: result.status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

interface StoredExport {
  client: Client;
  tag: string;
  fileName: string;
  sizeBytes: number;
}

async function upload(
  userId: string,
  target: ResolvedTarget,
  at: Date,
  deadline: AbortSignal
): Promise<StoredExport> {
  const { instanceName } = await getInstanceSettings();
  const data = await buildAccountExport(userId, instanceName);
  if (!data) throw new WebdavSyncError("notConfigured");
  // Gzipped to a temp file page by page: the document can exceed V8's string
  // limit, and gzipSync would block the event loop (forgejo#355).
  const tmpDir = await mkdtemp(path.join(tmpdir(), "travstats-sync-"));
  const tmpFile = path.join(tmpDir, "export.json.gz");
  try {
    await writeJsonGzipFile(data, tmpFile);
    const sizeBytes = (await stat(tmpFile)).size;
    return await send(userId, target, at, deadline, tmpFile, sizeBytes);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function send(
  userId: string,
  target: ResolvedTarget,
  at: Date,
  deadline: AbortSignal,
  tmpFile: string,
  sizeBytes: number
): Promise<StoredExport> {
  const tag = exportOwnerTag(userId);
  const fileName = exportFileName(at, tag);

  const client = createClient(target.url, {
    username: target.username,
    password: target.password,
    ...guardedAgents(target.policy),
  });
  await ensureFolder(client, target.remotePath, deadline);
  const stored = await client.putFileContents(
    path.posix.join(target.remotePath, fileName),
    createReadStream(tmpFile),
    {
      overwrite: false,
      contentLength: sizeBytes,
      // webdav sends no Content-Length for a Readable body, so say it explicitly.
      headers: { "Content-Length": String(sizeBytes) },
      signal: requestSignal(deadline, UPLOAD_TIMEOUT_MS),
    }
  );
  // With `overwrite: false` the client answers a 412 (the name is taken) with
  // `false` instead of throwing: nothing new is on the share, so this is no
  // success, and retention must not run on its strength (Codex review).
  if (stored !== true) throw new WebdavSyncError("protocol", "upload not accepted");
  return { client, tag, fileName, sizeBytes };
}

/**
 * The clean-up after a stored upload. Never throws: the export is on the
 * share, so whatever happens here — the deadline included — is a "partial"
 * with its cause, and the upload's name and size are kept (Codex review: a
 * race around upload AND clean-up recorded a stored export as failed).
 */
async function cleanUp(
  userId: string,
  target: ResolvedTarget,
  stored: StoredExport,
  deadline: AbortSignal
): Promise<{ result: WebdavRunResult; history: string[] }> {
  const { client, tag, fileName, sizeBytes } = stored;
  // The export is on the share; a failed clean-up must not turn that into a
  // failure, nor be swallowed — it is reported as "partial" with its cause.
  // The clean-up gets a budget of its own inside the run's deadline; running
  // out of either is a "partial" with `timeout`, never a failure.
  const retention = AbortSignal.any([deadline, AbortSignal.timeout(RETENTION_BUDGET_MS)]);
  // What is known to be on the share once the upload is in: the record plus it.
  const progress = { history: recordUpload(target.history, fileName), deleted: 0 };
  const uploaded = { fileName, sizeBytes };
  try {
    const { deleted, history, complete } = await untilAborted(
      retention,
      pruneOwnExports(
        client,
        target.remotePath,
        progress.history,
        target.keepVersions,
        ownExportPattern(tag),
        () => requestSignal(retention, REQUEST_TIMEOUT_MS),
        progress
      )
    );
    if (!complete) {
      logger.warn({ operation: "webdav_user_sync_retention_bounded", userId, deleted });
      return {
        result: { status: "partial", errorCode: "cleanupIncomplete", ...uploaded, deleted },
        history,
      };
    }
    return { result: { status: "ok", errorCode: null, ...uploaded, deleted }, history };
  } catch (error) {
    const errorCode = classifyWebdavError(error);
    logger.warn({ operation: "webdav_user_sync_retention_failed", userId, code: errorCode });
    return {
      result: { status: "partial", errorCode, ...uploaded, deleted: progress.deleted },
      history: progress.history,
    };
  }
}

/**
 * Run the sync for one account and record the outcome. Resolves with the
 * result for "ok" and "partial"; throws a `WebdavSyncError` for "failed",
 * AFTER recording it — so a clicked run's job fails with the same code the
 * page then shows as the last result. A run that outlives its deadline
 * (`deadlineMs`, default RUN_DEADLINE_MS) fails with `timeout` and frees the
 * account for the next run.
 */
export async function runWebdavSync(
  userId: string,
  options: { deadlineMs?: number } = {}
): Promise<WebdavRunResult> {
  if (running.has(userId)) throw new WebdavSyncError("alreadyRunning");
  const token = Symbol(userId);
  running.set(userId, token);
  const release = (): void => {
    if (running.get(userId) === token) running.delete(userId);
  };
  const at = new Date();
  const deadline = new AbortController();
  // At the deadline the account is free again, whatever is still hanging —
  // a share, or the database itself.
  const timer = setTimeout(() => {
    deadline.abort(new WebdavSyncError("timeout", "run deadline reached"));
    release();
  }, options.deadlineMs ?? RUN_DEADLINE_MS);
  timer.unref();
  try {
    let target: ResolvedTarget;
    try {
      const claimed = await untilAborted(deadline.signal, claim(userId, at));
      if (!claimed) {
        // No row (nothing to sync) or a newer run already holds it.
        const exists = await untilAborted(
          deadline.signal,
          prisma.userWebdavSync.count({ where: { userId } })
        );
        throw new WebdavSyncError(exists ? "alreadyRunning" : "notConfigured");
      }
      target = await untilAborted(deadline.signal, resolveTarget(userId));
    } catch (error) {
      const code = classifyWebdavError(error);
      // A newer run's row is not this run's to write; without a row the
      // guarded write simply matches nothing.
      if (code !== "alreadyRunning") await record(userId, failed(code), at);
      throw new WebdavSyncError(code);
    }
    let stored: StoredExport;
    try {
      stored = await untilAborted(deadline.signal, upload(userId, target, at, deadline.signal));
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
    const { result, history } = await cleanUp(userId, target, stored, deadline.signal);
    await record(userId, result, at, history);
    logger.info({
      operation: "webdav_user_sync_done",
      userId,
      status: result.status,
      sizeBytes: result.sizeBytes,
      deleted: result.deleted,
    });
    return result;
  } finally {
    clearTimeout(timer);
    release();
  }
}

function failed(code: WebdavSyncErrorCode): WebdavRunResult {
  return { status: "failed", errorCode: code, fileName: null, sizeBytes: null, deleted: 0 };
}
