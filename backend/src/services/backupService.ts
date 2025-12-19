import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { prisma } from '../db';
import logger from '../utils/logger';
import { DATABASE_URL } from '../utils/database';

const execAsync = promisify(exec);

interface BackupOptions {
  type?: 'full' | 'partial';
  retentionDays?: number;
}

interface RestoreOptions {
  scope: 'full' | 'database' | 'files';
  createBackupBefore?: boolean;
  targetDatabaseUrl?: string;
}

const BACKUP_BASE_DIR = process.env.BACKUP_PATH || '/app/data/backups';
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
const DOCKER_DB_CONTAINER = process.env.DOCKER_DB_CONTAINER || 'travstats-db';
const DB_NAME = process.env.POSTGRES_DB || 'flights';
const DB_USER = process.env.POSTGRES_USER || 'flights';

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_BASE_DIR)) {
  fs.mkdirSync(BACKUP_BASE_DIR, { recursive: true });
}

/**
 * Extract database connection info from DATABASE_URL
 */
function parseDatabaseUrl(url: string): { host: string; port: string; user: string; password: string; database: string } {
  const match = url.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (!match) {
    throw new Error('Invalid DATABASE_URL format');
  }
  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: match[4],
    database: match[5],
  };
}

/**
 * Execute pg_dump to create database backup
 */
async function createDatabaseDump(outputPath: string, targetDatabaseUrl?: string): Promise<void> {
  const dbUrl = targetDatabaseUrl || DATABASE_URL;
  const dbInfo = parseDatabaseUrl(dbUrl);

  // Check if we're in Docker and can use docker exec
  const isDocker = process.env.DOCKER === 'true';
  const dbContainer = process.env.DOCKER_DB_CONTAINER || DOCKER_DB_CONTAINER;

  let command: string;

  if (isDocker) {
    // Try docker exec first
    try {
      // Check if container exists
      await execAsync(`docker ps --filter name=${dbContainer} --format "{{.Names}}"`);
      command = `docker exec ${dbContainer} pg_dump -U ${dbInfo.user} -F p ${dbInfo.database} > ${outputPath}`;
    } catch (error) {
      // Fallback to direct connection
      logger.warn({ operation: 'backup_db_docker_fallback', message: 'Docker exec failed, using direct connection' });
      command = `PGPASSWORD="${dbInfo.password}" pg_dump -h ${dbInfo.host} -p ${dbInfo.port} -U ${dbInfo.user} -F p ${dbInfo.database} > ${outputPath}`;
    }
  } else {
    // Direct connection
    command = `PGPASSWORD="${dbInfo.password}" pg_dump -h ${dbInfo.host} -p ${dbInfo.port} -U ${dbInfo.user} -F p ${dbInfo.database} > ${outputPath}`;
  }

  try {
    await execAsync(command, { maxBuffer: 100 * 1024 * 1024 }); // 100MB buffer
  } catch (error) {
    logger.error({
      operation: 'backup_db_error',
      message: 'Database backup failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw new Error(`Database backup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Archive upload directories
 */
async function archiveUploads(outputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const uploadsDir = path.join(__dirname, '../../uploads');
    
    if (!fs.existsSync(uploadsDir)) {
      logger.warn({ operation: 'backup_files_missing', message: 'Uploads directory not found' });
      // Create empty archive
      const archive = archiver('tar', { gzip: true });
      const output = fs.createWriteStream(outputPath);
      
      archive.pipe(output);
      archive.finalize();
      
      output.on('close', () => resolve(0));
      output.on('error', reject);
      return;
    }

    const archive = archiver('tar', { gzip: true });
    const output = fs.createWriteStream(outputPath);

    archive.pipe(output);

    // Add all upload directories
    const dirs = ['receipts', 'emails', 'training'];
    dirs.forEach((dir) => {
      const dirPath = path.join(uploadsDir, dir);
      if (fs.existsSync(dirPath)) {
        archive.directory(dirPath, `uploads/${dir}`);
      }
    });

    archive.on('error', (err: Error) => {
      logger.error({
        operation: 'backup_files_error',
        message: 'File archive creation failed',
        error: err.message,
      });
      reject(err);
    });

    output.on('close', () => {
      resolve(archive.pointer());
    });

    archive.finalize();
  });
}

/**
 * Get metadata about current database state
 */
async function getMetadata(): Promise<Record<string, any>> {
  const [userCount, flightCount, airportCount, achievementCount] = await Promise.all([
    prisma.user.count(),
    prisma.flight.count(),
    prisma.airport.count(),
    prisma.achievement.count(),
  ]);

  return {
    userCount,
    flightCount,
    airportCount,
    achievementCount,
    timestamp: new Date().toISOString(),
    instanceName: process.env.INSTANCE_NAME || 'TravStats',
  };
}

/**
 * Create a new backup
 */
export async function createBackup(options: BackupOptions = {}): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupId = `backup-${timestamp}`;
  const backupDir = path.join(BACKUP_BASE_DIR, backupId);
  const tempDir = path.join(backupDir, 'temp');

  // Create directories
  fs.mkdirSync(tempDir, { recursive: true });

  const dbBackupPath = path.join(tempDir, 'database.sql');
  const filesBackupPath = path.join(tempDir, 'uploads.tar.gz');
  const finalArchivePath = path.join(backupDir, `${backupId}.tar.gz`);

  // Create backup record
  const backup = await prisma.backup.create({
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

  try {
    logger.info({
      operation: 'backup_start',
      message: 'Starting backup',
      backupId: backup.id,
    });

    // Step 1: Backup database
    logger.info({ operation: 'backup_db_start', message: 'Backing up database' });
    await createDatabaseDump(dbBackupPath);
    const dbSize = fs.statSync(dbBackupPath).size;

    // Step 2: Archive uploads
    logger.info({ operation: 'backup_files_start', message: 'Archiving upload files' });
    const filesSize = await archiveUploads(filesBackupPath);

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
export async function listBackups() {
  return prisma.backup.findMany({
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get backup by ID
 */
export async function getBackup(id: string) {
  const backup = await prisma.backup.findUnique({
    where: { id },
  });

  if (!backup) {
    throw new Error('Backup not found');
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
    throw new Error('Backup not found');
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
  const backup = await prisma.backup.findUnique({
    where: { id },
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

  // Create backup before restore if requested
  if (options.createBackupBefore) {
    logger.info({
      operation: 'restore_backup_before',
      message: 'Creating backup before restore',
    });
    await createBackup({ type: 'full' });
  }

  const tempDir = path.join(BACKUP_BASE_DIR, 'restore-temp');
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Extract archive
    logger.info({ operation: 'restore_extract', message: 'Extracting backup archive' });
    await new Promise<void>((resolve, reject) => {
      const { spawn } = require('child_process');
      const tar = spawn('tar', ['-xzf', backup.backupPath, '-C', tempDir]);

      tar.on('close', (code: number) => {
        if (code !== 0) {
          reject(new Error(`tar extraction failed with code ${code}`));
        } else {
          resolve();
        }
      });

      tar.on('error', reject);
    });

    const dbBackupPath = path.join(tempDir, 'database.sql');
    const filesBackupPath = path.join(tempDir, 'uploads.tar.gz');

    // Restore database if requested
    if (options.scope === 'full' || options.scope === 'database') {
      if (!fs.existsSync(dbBackupPath)) {
        throw new Error('Database backup file not found in archive');
      }

      logger.info({ operation: 'restore_db', message: 'Restoring database' });
      const dbUrl = options.targetDatabaseUrl || DATABASE_URL;
      const dbInfo = parseDatabaseUrl(dbUrl);

      const isDocker = process.env.DOCKER === 'true';
      const dbContainer = process.env.DOCKER_DB_CONTAINER || DOCKER_DB_CONTAINER;

      let command: string;

      if (isDocker) {
        try {
          await execAsync(`docker ps --filter name=${dbContainer} --format "{{.Names}}"`);
          command = `cat ${dbBackupPath} | docker exec -i ${dbContainer} psql -U ${dbInfo.user} ${dbInfo.database}`;
        } catch (error) {
          command = `PGPASSWORD="${dbInfo.password}" psql -h ${dbInfo.host} -p ${dbInfo.port} -U ${dbInfo.user} ${dbInfo.database} < ${dbBackupPath}`;
        }
      } else {
        command = `PGPASSWORD="${dbInfo.password}" psql -h ${dbInfo.host} -p ${dbInfo.port} -U ${dbInfo.user} ${dbInfo.database} < ${dbBackupPath}`;
      }

      await execAsync(command);
      logger.info({ operation: 'restore_db_complete', message: 'Database restored' });
    }

    // Restore files if requested
    if (options.scope === 'full' || options.scope === 'files') {
      if (!fs.existsSync(filesBackupPath)) {
        logger.warn({ operation: 'restore_files_missing', message: 'Files backup not found in archive' });
      } else {
        logger.info({ operation: 'restore_files', message: 'Restoring files' });
        const uploadsDir = path.join(__dirname, '../../uploads');
        fs.mkdirSync(uploadsDir, { recursive: true });

        await new Promise<void>((resolve, reject) => {
          const { spawn } = require('child_process');
          const tar = spawn('tar', ['-xzf', filesBackupPath, '-C', uploadsDir]);

          tar.on('close', (code: number) => {
            if (code !== 0) {
              reject(new Error(`tar extraction failed with code ${code}`));
            } else {
              resolve();
            }
          });

          tar.on('error', reject);
        });

        logger.info({ operation: 'restore_files_complete', message: 'Files restored' });
      }
    }

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });

    logger.info({
      operation: 'restore_complete',
      message: 'Backup restored successfully',
      backupId: id,
      scope: options.scope,
    });
  } catch (error) {
    // Cleanup on error
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    logger.error({
      operation: 'restore_failed',
      message: 'Restore failed',
      backupId: id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
}

/**
 * Cleanup old backups based on retention policy
 */
export async function cleanupOldBackups(): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

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

