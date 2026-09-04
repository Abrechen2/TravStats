import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { prisma } from '../db';
import logger from '../utils/logger';
import { Backup } from '@prisma/client';
import {
  BACKUP_BASE_DIR,
  RETENTION_DAYS,
  BackupOptions,
  RestoreOptions,
} from './backup/backupConfig';
import { createDatabaseDump } from './backup/backupDatabase';
import { archiveUploads, getMetadata } from './backup/backupFiles';
import { restoreBackup as restoreBackupImpl } from './backup/backupRestore';
import { AppError } from '../middleware/errorHandler';

// Re-export types for backward compatibility
export type { BackupOptions, RestoreOptions } from './backup/backupConfig';
export type { ExistingBackupRecord } from './backup/backupConfig';

/**
 * Create a new backup
 */
export async function createBackup(options: BackupOptions = {}): Promise<string> {
  logger.info({
    operation: 'backup_create_start',
    message: 'Starting backup creation',
    backupBaseDir: BACKUP_BASE_DIR,
    backupPathEnv: process.env.BACKUP_PATH,
    platform: process.platform,
    docker: process.env.DOCKER,
  });

  // When the route pre-creates the DB record inside a Serializable transaction it also
  // pre-computes the paths and passes them via existingRecord. Reuse those paths so
  // the filesystem layout matches what is already stored in the database — critically
  // including backupDir/tempDir, otherwise pg_dump writes into a directory that was
  // never created and fails with "Directory nonexistent".
  // When called without an existingRecord (e.g. from restoreBackup), generate fresh paths.
  let backupId: string;
  let backupDir: string;
  let tempDir: string;
  if (options.existingRecord) {
    backupId = options.existingRecord.id;
    // existingRecord.dbBackupPath is <backupDir>/temp/database.sql
    tempDir = path.dirname(options.existingRecord.dbBackupPath);
    backupDir = path.dirname(tempDir);
  } else {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupId = `backup-${timestamp}`;
    backupDir = path.join(BACKUP_BASE_DIR, backupId);
    tempDir = path.join(backupDir, 'temp');
  }

  // Ensure backup base directory exists
  try {
    if (!fs.existsSync(BACKUP_BASE_DIR)) {
      logger.info({
        operation: 'backup_dir_creating',
        message: `Creating backup directory: ${BACKUP_BASE_DIR}`,
      });
      fs.mkdirSync(BACKUP_BASE_DIR, { recursive: true });
      logger.info({
        operation: 'backup_dir_created',
        message: `Created backup directory: ${BACKUP_BASE_DIR}`,
      });
    } else {
      logger.info({
        operation: 'backup_dir_exists',
        message: `Backup directory already exists: ${BACKUP_BASE_DIR}`,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({
      operation: 'backup_dir_creation_failed',
      message: 'Failed to create backup directory',
      error: errorMessage,
      backupBaseDir: BACKUP_BASE_DIR,
      platform: process.platform,
    });
    throw new Error(`Failed to create backup directory: ${errorMessage}`);
  }

  // Create directories
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch (error) {
    logger.error({
      operation: 'backup_temp_dir_creation_failed',
      message: 'Failed to create temp directory',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error(`Failed to create temp directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // When an existingRecord is provided, its paths already match what was stored in the DB.
  // Otherwise derive them from the locally generated backupId (same formula as always).
  const dbBackupPath = options.existingRecord?.dbBackupPath ?? path.join(tempDir, 'database.sql');
  const filesBackupPath = options.existingRecord?.filesBackupPath ?? path.join(tempDir, 'uploads.tar.gz');
  const finalArchivePath = options.existingRecord?.backupPath ?? path.join(backupDir, `${backupId}.tar.gz`);

  // Create backup record — or reuse one that was already created atomically inside a
  // Serializable transaction by the route handler (TOCTOU prevention).
  let backup: { id: string };
  if (options.existingRecord) {
    backup = { id: options.existingRecord.id };
    logger.info({
      operation: 'backup_record_reused',
      message: 'Reusing backup record created inside transaction',
      backupId: backup.id,
    });
  } else {
    try {
      logger.info({
        operation: 'backup_record_creation_start',
        message: 'Creating backup record in database',
        backupPath: finalArchivePath,
        backupDir,
      });

      backup = await prisma.backup.create({
        data: {
          type: options.type || 'full',
          status: 'running',
          backupPath: finalArchivePath,
          dbBackupPath,
          filesBackupPath,
          retentionDays: options.retentionDays || RETENTION_DAYS,
          startedAt: new Date(),
        },
      });

      logger.info({
        operation: 'backup_record_created',
        message: 'Backup record created successfully',
        backupId: backup.id,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error({
        operation: 'backup_record_creation_failed',
        message: 'Failed to create backup record in database',
        error: errorMessage,
        stack: errorStack,
        backupPath: finalArchivePath,
        backupDir,
      });

      // Cleanup temp directory
      try {
        if (fs.existsSync(backupDir)) {
          fs.rmSync(backupDir, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        logger.warn({
          operation: 'backup_cleanup_failed',
          message: 'Failed to cleanup temp directory after error',
          error: cleanupError instanceof Error ? cleanupError.message : 'Unknown error',
        });
      }

      // Provide more specific error message
      if (errorMessage.includes('does not exist') || errorMessage.includes('relation') || errorMessage.includes('table')) {
        throw new Error(`Backup table does not exist. Please run database migrations: ${errorMessage}`);
      }

      throw new Error(`Failed to create backup record: ${errorMessage}`);
    }
  }

  try {
    logger.info({
      operation: 'backup_start',
      message: 'Starting backup',
      backupId: backup.id,
    });

    // Step 1: Backup database
    logger.info({ operation: 'backup_db_start', message: 'Backing up database' });
    await createDatabaseDump(dbBackupPath);
    fs.statSync(dbBackupPath); // verify dump was created

    // Step 2: Archive uploads
    logger.info({ operation: 'backup_files_start', message: 'Archiving upload files' });
    await archiveUploads(filesBackupPath);

    // Step 3: Get metadata
    const metadata = await getMetadata();

    // Step 4: Create final archive
    logger.info({ operation: 'backup_archive_start', message: 'Creating final archive' });
    await new Promise<void>((resolve, reject) => {
      const archive = archiver('tar', { gzip: true });
      const output = fs.createWriteStream(finalArchivePath);

      archive.pipe(output);
      archive.file(dbBackupPath, { name: 'database.sql' });
      archive.file(filesBackupPath, { name: 'uploads.tar.gz' });
      archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

      archive.on('error', reject);
      output.on('close', resolve);
      archive.finalize();
    });

    const totalSize = fs.statSync(finalArchivePath).size;

    // Step 5: Cleanup temp files
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Step 6: Update backup record
    await prisma.backup.update({
      where: { id: backup.id },
      data: {
        status: 'completed',
        size: BigInt(totalSize),
        completedAt: new Date(),
        metadata,
      },
    });

    logger.info({
      operation: 'backup_complete',
      message: 'Backup completed successfully',
      backupId: backup.id,
      size: totalSize,
    });

    return backup.id;
  } catch (error) {
    // Update backup record with error
    await prisma.backup.update({
      where: { id: backup.id },
      data: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      },
    });

    // Cleanup on error
    try {
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      logger.error({
        operation: 'backup_cleanup_error',
        message: 'Failed to cleanup failed backup',
        error: cleanupError instanceof Error ? cleanupError.message : 'Unknown error',
      });
    }

    logger.error({
      operation: 'backup_failed',
      message: 'Backup failed',
      backupId: backup.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

/**
 * List all backups
 */
export async function listBackups(): Promise<Backup[]> {
  return prisma.backup.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get backup by ID
 */
export async function getBackup(id: string): Promise<Backup & { fileExists: boolean }> {
  const backup = await prisma.backup.findUnique({
    where: { id },
  });

  if (!backup) {
    throw new AppError('Backup not found', 404);
  }

  // Check if backup file still exists
  const exists = backup.backupPath ? fs.existsSync(backup.backupPath) : false;

  return {
    ...backup,
    fileExists: exists,
  };
}

/**
 * Delete backup
 */
export async function deleteBackup(id: string): Promise<void> {
  const backup = await prisma.backup.findUnique({
    where: { id },
  });

  if (!backup) {
    throw new AppError('Backup not found', 404);
  }

  // Delete backup files
  if (backup.backupPath && fs.existsSync(backup.backupPath)) {
    const backupDir = path.dirname(backup.backupPath);
    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  }

  // Delete database record
  await prisma.backup.delete({
    where: { id },
  });

  logger.info({
    operation: 'backup_deleted',
    message: 'Backup deleted',
    backupId: id,
  });
}

/**
 * Restore backup
 */
export async function restoreBackup(id: string, options: RestoreOptions): Promise<void> {
  return restoreBackupImpl(id, options, createBackup);
}

/**
 * Cleanup old backups based on retention policy
 */
export async function cleanupOldBackups(): Promise<number> {
  const adminSettings = await prisma.adminSettings.findFirst();
  const retentionDays = adminSettings?.backupRetentionDays ?? RETENTION_DAYS;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const oldBackups = await prisma.backup.findMany({
    where: {
      createdAt: {
        lt: cutoffDate,
      },
      status: 'completed',
    },
  });

  let deletedCount = 0;

  for (const backup of oldBackups) {
    try {
      await deleteBackup(backup.id);
      deletedCount++;
    } catch (error) {
      logger.error({
        operation: 'cleanup_backup_error',
        message: 'Failed to delete old backup',
        backupId: backup.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.info({
    operation: 'cleanup_complete',
    message: 'Old backups cleaned up',
    deletedCount,
  });

  return deletedCount;
}
