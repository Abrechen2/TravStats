import { createClient } from 'webdav';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../db';
import { getWebDAVSettings } from './instanceSettingsService';
import logger from '../utils/logger';

type WebDAVClient = ReturnType<typeof createClient>;

/**
 * Build a WebDAV client from current DB settings (with ENV fallback).
 * Throws if sync is disabled or any required field is missing.
 */
async function getWebDAVClient(): Promise<{ client: WebDAVClient; backupPath: string }> {
  const { enabled, url, username, password, backupPath } = await getWebDAVSettings();
  if (!enabled || !url || !username || !password) {
    throw new Error('WebDAV is not configured');
  }
  return {
    client: createClient(url, { username, password }),
    backupPath,
  };
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
  const { enabled } = await getWebDAVSettings();
  if (!enabled) {
    throw new Error('WebDAV sync is not enabled');
  }

  const backup = await prisma.backup.findUnique({ where: { id: backupId } });

  if (!backup) {
    throw new Error('Backup not found');
  }

  if (backup.status !== 'completed') {
    throw new Error('Backup is not completed');
  }

  if (!backup.backupPath || !fs.existsSync(backup.backupPath)) {
    throw new Error('Backup file not found');
  }

  try {
    const { client, backupPath } = await getWebDAVClient();

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
    throw error;
  }
}

/** List backups available on the remote WebDAV share. */
export async function listCloudBackups(): Promise<
  Array<{ name: string; size: number; lastModified: Date }>
> {
  const { enabled } = await getWebDAVSettings();
  if (!enabled) {
    throw new Error('WebDAV sync is not enabled');
  }

  try {
    const { client, backupPath } = await getWebDAVClient();

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
    throw error;
  }
}

/** Download a backup file from the remote WebDAV share to local disk. */
export async function downloadFromCloud(backupName: string, localPath: string): Promise<void> {
  const { enabled } = await getWebDAVSettings();
  if (!enabled) {
    throw new Error('WebDAV sync is not enabled');
  }

  try {
    const { client, backupPath } = await getWebDAVClient();
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
    throw error;
  }
}
