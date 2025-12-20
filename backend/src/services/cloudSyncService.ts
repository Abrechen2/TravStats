import { createClient } from 'webdav';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../db';
import logger from '../utils/logger';

const WEBDAV_URL = process.env.WEBDAV_URL || '';
const WEBDAV_USERNAME = process.env.WEBDAV_USERNAME || '';
const WEBDAV_PASSWORD = process.env.WEBDAV_PASSWORD || '';
const WEBDAV_BACKUP_PATH = process.env.WEBDAV_BACKUP_PATH || '/TravStats/backups/';
const WEBDAV_SYNC_ENABLED = process.env.WEBDAV_SYNC_ENABLED === 'true';

let webdavClient: ReturnType<typeof createClient> | null = null;

/**
 * Initialize WebDAV client
 */
function getWebDAVClient() {
  if (!WEBDAV_SYNC_ENABLED || !WEBDAV_URL || !WEBDAV_USERNAME || !WEBDAV_PASSWORD) {
    throw new Error('WebDAV is not configured');
  }

  if (!webdavClient) {
    webdavClient = createClient(WEBDAV_URL, {
      username: WEBDAV_USERNAME,
      password: WEBDAV_PASSWORD,
    });
  }

  return webdavClient;
}

/**
 * Test WebDAV connection
 */
export async function testConnection(): Promise<{ success: boolean; message: string }> {
  try {
    if (!WEBDAV_SYNC_ENABLED) {
      return { success: false, message: 'WebDAV sync is not enabled' };
    }

    const client = getWebDAVClient();
    const directoryItems = await client.getDirectoryContents('/');

    return {
      success: true,
      message: 'WebDAV connection successful',
    };
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

/**
 * Sync backup to WebDAV
 */
export async function syncToCloud(backupId: string): Promise<void> {
  if (!WEBDAV_SYNC_ENABLED) {
    throw new Error('WebDAV sync is not enabled');
  }

  const backup = await prisma.backup.findUnique({
    where: { id: backupId },
  });

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
    const client = getWebDAVClient();

    // Ensure backup directory exists on WebDAV
    try {
      await client.createDirectory(WEBDAV_BACKUP_PATH, { recursive: true });
    } catch (error) {
      // Directory might already exist, ignore
    }

    const filename = path.basename(backup.backupPath);
    const remotePath = path.join(WEBDAV_BACKUP_PATH, filename).replace(/\\/g, '/');

    logger.info({
      operation: 'webdav_upload_start',
      message: 'Uploading backup to WebDAV',
      backupId,
      remotePath,
    });

    // Read file and upload
    const fileBuffer = fs.readFileSync(backup.backupPath);
    await client.putFileContents(remotePath, fileBuffer, { overwrite: true });

    // Update backup record
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

/**
 * List backups from WebDAV
 */
export async function listCloudBackups(): Promise<Array<{ name: string; size: number; lastModified: Date }>> {
  if (!WEBDAV_SYNC_ENABLED) {
    throw new Error('WebDAV sync is not enabled');
  }

  try {
    const client = getWebDAVClient();

    // Ensure directory exists
    try {
      await client.createDirectory(WEBDAV_BACKUP_PATH, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    const items = await client.getDirectoryContents(WEBDAV_BACKUP_PATH);

    // Ensure items is an array
    const itemsArray = Array.isArray(items) ? items : (items as any).data || [];

    return itemsArray
      .filter((item: any) => item.type === 'file' && item.basename?.endsWith('.tar.gz'))
      .map((item: any) => ({
        name: item.basename,
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

/**
 * Download backup from WebDAV
 */
export async function downloadFromCloud(backupName: string, localPath: string): Promise<void> {
  if (!WEBDAV_SYNC_ENABLED) {
    throw new Error('WebDAV sync is not enabled');
  }

  try {
    const client = getWebDAVClient();
    const remotePath = path.join(WEBDAV_BACKUP_PATH, backupName).replace(/\\/g, '/');

    logger.info({
      operation: 'webdav_download_start',
      message: 'Downloading backup from WebDAV',
      remotePath,
      localPath,
    });

    const fileBuffer = await client.getFileContents(remotePath, { format: 'binary' }) as Buffer;
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





