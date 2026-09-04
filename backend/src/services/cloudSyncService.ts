import { createClient } from 'webdav';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../db';
import { getWebDAVSettings } from './instanceSettingsService';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';

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
 * Build a WebDAV client from current DB settings (with ENV fallback).
 * Throws 409 if sync is disabled or any required field is missing.
 */
async function getWebDAVClient(): Promise<{ client: WebDAVClient; backupPath: string }> {
  const { enabled, url, username, password, backupPath } = await getWebDAVSettings();
  if (!enabled) {
    throw new AppError('WebDAV sync is not enabled', 409);
  }
  if (!url || !username || !password) {
    throw new AppError('WebDAV is not configured', 409);
  }
  return {
    client: createClient(url, { username, password }),
    backupPath,
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
  if (status === 404) return new AppError('Backup not found on the WebDAV share', 404);
  // The share's own words stay in the message: "507 Insufficient Storage" is
  // what the admin has to act on, and the status alone would hide it.
  const reason = error instanceof Error ? error.message : 'Unknown error';
  return new AppError(`WebDAV share did not answer as expected: ${reason}`, 502);
}

/** Test WebDAV connection. */
export async function testConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const { enabled } = await getWebDAVSettings();
    if (!enabled) {
      return { success: false, message: 'WebDAV sync is not enabled' };
    }

    const { client } = await getWebDAVClient();
    await client.getDirectoryContents('/');

    return { success: true, message: 'WebDAV connection successful' };
  } catch (error) {
    logger.error({
      operation: 'webdav_test_error',
      message: 'WebDAV connection test failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/** Sync a completed backup to WebDAV. */
export async function syncToCloud(backupId: string): Promise<void> {
  // The backup is looked up BEFORE the feature flag: "that backup does not
  // exist" is the more specific fact, and an unknown id should read 404
  // whether or not the operator has switched WebDAV on.
  const backup = await prisma.backup.findUnique({ where: { id: backupId } });

  if (!backup) {
    throw new AppError('Backup not found', 404);
  }

  if (backup.status !== 'completed') {
    throw new AppError('Backup is not completed', 400);
  }

  if (!backup.backupPath || !fs.existsSync(backup.backupPath)) {
    throw new AppError('Backup file not found', 404);
  }

  const { client, backupPath } = await getWebDAVClient();

  try {
    // Ensure backup directory exists on WebDAV (ignore if it already does)
    try {
      await client.createDirectory(backupPath, { recursive: true });
    } catch {
      // Directory might already exist
    }

    const filename = path.basename(backup.backupPath);
    const remotePath = path.join(backupPath, filename).replace(/\\/g, '/');

    logger.info({
      operation: 'webdav_upload_start',
      message: 'Uploading backup to WebDAV',
      backupId,
      remotePath,
    });

    const fileBuffer = fs.readFileSync(backup.backupPath);
    await client.putFileContents(remotePath, fileBuffer, { overwrite: true });

    await prisma.backup.update({
      where: { id: backupId },
      data: {
        syncedToCloud: true,
        cloudSyncAt: new Date(),
      },
    });

    logger.info({
      operation: 'webdav_upload_complete',
      message: 'Backup uploaded to WebDAV successfully',
      backupId,
      remotePath,
    });
  } catch (error) {
    logger.error({
      operation: 'webdav_upload_error',
      message: 'Failed to upload backup to WebDAV',
      backupId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw asUpstreamError(error);
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
      : ((items as { data?: WebDAVItem[] }).data || []);

    return itemsArray
      .filter((item) => item.type === 'file' && item.basename?.endsWith('.tar.gz'))
      .map((item) => ({
        name: item.basename || '',
        size: item.size || 0,
        lastModified: item.lastmod ? new Date(item.lastmod) : new Date(),
      }));
  } catch (error) {
    logger.error({
      operation: 'webdav_list_error',
      message: 'Failed to list backups from WebDAV',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw asUpstreamError(error);
  }
}

/** Download a backup file from the remote WebDAV share to local disk. */
export async function downloadFromCloud(backupName: string, localPath: string): Promise<void> {
  const { client, backupPath } = await getWebDAVClient();

  try {
    const remotePath = path.join(backupPath, backupName).replace(/\\/g, '/');

    logger.info({
      operation: 'webdav_download_start',
      message: 'Downloading backup from WebDAV',
      remotePath,
      localPath,
    });

    const fileBuffer = (await client.getFileContents(remotePath, { format: 'binary' })) as Buffer;
    fs.writeFileSync(localPath, fileBuffer);

    logger.info({
      operation: 'webdav_download_complete',
      message: 'Backup downloaded from WebDAV successfully',
      remotePath,
      localPath,
    });
  } catch (error) {
    logger.error({
      operation: 'webdav_download_error',
      message: 'Failed to download backup from WebDAV',
      backupName,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw asUpstreamError(error);
  }
}
