import * as fs from 'fs';
import * as path from 'path';
import logger from '../../utils/logger';

export interface ExistingBackupRecord {
  id: string;
  backupPath: string;
  dbBackupPath: string;
  filesBackupPath: string;
}

export interface BackupOptions {
  type?: 'full' | 'partial';
  retentionDays?: number;
  /** When provided, skip creating a new DB record and use this pre-created one. */
  existingRecord?: ExistingBackupRecord;
}

export interface RestoreOptions {
  scope: 'full' | 'database' | 'files';
  createBackupBefore?: boolean;
  targetDatabaseUrl?: string;
}

// Use BACKUP_PATH from environment if set (e.g., in Docker: /app/data/backups)
// Otherwise use a platform-appropriate default
export const BACKUP_BASE_DIR = process.env.BACKUP_PATH || (
  process.platform === 'win32'
    ? path.join(process.cwd(), 'data', 'backups')
    : '/app/data/backups'
);
export const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
export const DOCKER_DB_CONTAINER = process.env.DOCKER_DB_CONTAINER || 'travstats-db';

// Ensure backup directory exists
// Wrap in try-catch to prevent startup failures if permissions are missing
try {
  if (!fs.existsSync(BACKUP_BASE_DIR)) {
    fs.mkdirSync(BACKUP_BASE_DIR, { recursive: true });
    logger.info({
      operation: 'backup_dir_created',
      message: `Created backup directory: ${BACKUP_BASE_DIR}`,
      context: { directory: BACKUP_BASE_DIR },
    });
  }
} catch (error: unknown) {
  // Log warning but don't prevent startup - directory will be created on first backup attempt
  const errorMsg = error instanceof Error ? error.message : 'Unknown error';
  logger.warn({ operation: 'backup_dir_creation_warning', message: `Could not create backup directory ${BACKUP_BASE_DIR}: ${errorMsg}` });
  logger.warn({ operation: 'backup_dir_creation_warning', message: 'Backups may fail until directory permissions are fixed' });
  logger.warn({
    operation: 'backup_dir_creation_failed',
    message: `Could not create backup directory: ${BACKUP_BASE_DIR}`,
    context: { directory: BACKUP_BASE_DIR, error: errorMsg },
  });
}
