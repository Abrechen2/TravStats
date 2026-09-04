import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../../db';
import logger from '../../utils/logger';
import { DATABASE_URL } from '../../utils/database';
import { BACKUP_BASE_DIR, DOCKER_DB_CONTAINER, RestoreOptions } from './backupConfig';
import { parseDatabaseUrl } from './backupDatabase';
import { AppError } from '../../middleware/errorHandler';

/**
 * Restore backup
 */
export async function restoreBackup(
  id: string,
  options: RestoreOptions,
  createBackupFn: (opts: { type: 'full' }) => Promise<string>,
): Promise<void> {
  const backup = await prisma.backup.findUnique({
    where: { id },
  });

  // Each precondition carries its status (forgejo#77): the route passes the
  // error straight to errorHandler, and a bare Error would reach the admin as
  // a 500 — a server fault — for an id that simply does not exist.
  if (!backup) {
    throw new AppError('Backup not found', 404);
  }

  if (backup.status !== 'completed') {
    throw new AppError('Backup is not completed', 400);
  }

  if (!backup.backupPath || !fs.existsSync(backup.backupPath)) {
    throw new AppError('Backup file not found', 404);
  }

  // Create backup before restore if requested
  if (options.createBackupBefore) {
    logger.info({
      operation: 'restore_backup_before',
      message: 'Creating backup before restore',
    });
    await createBackupFn({ type: 'full' });
  }

  const tempDir = path.join(BACKUP_BASE_DIR, 'restore-temp');
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Extract archive
    logger.info({ operation: 'restore_extract', message: 'Extracting backup archive' });
    await new Promise<void>((resolve, reject) => {
      const tar = spawn('tar', ['-xzf', backup.backupPath!, '-C', tempDir]);

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

      // Use spawn with array args to prevent shell injection (never interpolate into shell strings)
      const spawnRestore = (cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> =>
        new Promise<void>((resolve, reject) => {
          const inputFile = fs.createReadStream(dbBackupPath);
          const proc = spawn(cmd, args, {
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          inputFile.pipe(proc.stdin);
          proc.stdout.on('data', (data) => {
            logger.debug({ operation: 'restore_db_stdout', message: data.toString() });
          });
          proc.stderr.on('data', (data) => {
            logger.warn({ operation: 'restore_db_stderr', message: data.toString() });
          });
          proc.on('error', (error) => reject(new Error(`Failed to start ${cmd}: ${error.message}`)));
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited with code ${code}`));
          });
        });

      const restoreEnv = { ...process.env, PGPASSWORD: dbInfo.password };

      if (isDocker) {
        try {
          // Verify container exists using spawn (no shell interpolation)
          await new Promise<void>((resolve, reject) => {
            const proc = spawn('docker', ['ps', '--filter', `name=${dbContainer}`, '--format', '{{.Names}}'], { stdio: ['ignore', 'pipe', 'pipe'] });
            proc.on('close', (code) => code === 0 ? resolve() : reject(new Error('Docker container not found')));
            proc.on('error', reject);
          });
          await spawnRestore('docker', ['exec', '-i', dbContainer, 'psql', '-U', dbInfo.user, dbInfo.database], restoreEnv);
        } catch (_error) {
          // Fallback to direct psql if Docker not available
          await spawnRestore('psql', ['-h', dbInfo.host, '-p', dbInfo.port.toString(), '-U', dbInfo.user, dbInfo.database], restoreEnv);
        }
      } else {
        await spawnRestore('psql', ['-h', dbInfo.host, '-p', dbInfo.port.toString(), '-U', dbInfo.user, dbInfo.database], restoreEnv);
      }
      logger.info({ operation: 'restore_db_complete', message: 'Database restored' });
    }

    // Restore files if requested
    if (options.scope === 'full' || options.scope === 'files') {
      if (!fs.existsSync(filesBackupPath)) {
        logger.warn({ operation: 'restore_files_missing', message: 'Files backup not found in archive' });
      } else {
        logger.info({ operation: 'restore_files', message: 'Restoring files' });
        const uploadsDir = path.join(__dirname, '../../../uploads');
        fs.mkdirSync(uploadsDir, { recursive: true });

        await new Promise<void>((resolve, reject) => {
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
