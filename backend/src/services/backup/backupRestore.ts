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
/**
 * psql's own exit code is not an opinion about the SQL it just ran.
 *
 * Without ON_ERROR_STOP it reports every statement's failure on stderr, carries
 * on with the next one and exits 0. Measured on 2026-09-09: restoring a backup
 * over a database that had moved on produced "relation already exists" and
 * duplicate-key errors for the whole file, exit code 0, a success message in the
 * UI — and the old data untouched (audit finding AUD-007). A restore that
 * silently does nothing is worse than one that fails, because it is believed.
 *
 * --single-transaction makes it all-or-nothing as well: a restore that stops
 * halfway leaves a database that is neither the backup nor what was there.
 *
 * The dumps carry --clean --if-exists since the same day, so a restore now
 * REPLACES what it finds. An archive written before that will fail here rather
 * than pretend, and the message says which — see the catch below.
 */
/**
 * Unpack an uploads archive so the files land where their database rows expect.
 *
 * The archive stores its entries as `uploads/<dir>/...` (see backupFiles.ts), so
 * the extraction target is the PARENT of the uploads directory, not the uploads
 * directory itself. Extracting into `uploads` produced `uploads/uploads/<dir>/…`:
 * every image and receipt restored, reported as restored, and unreachable under
 * the filename stored in the database (audit finding AUD-006).
 *
 * Fixing the target rather than the archive layout keeps every backup already
 * written restorable — the old archives are not wrong, the unpacking was.
 *
 * Exported for the round-trip test: the pairing of layout and target is the
 * thing that broke, and a test that only reads the tarball cannot see it.
 */
export async function extractUploadsArchive(archivePath: string, uploadsDir: string): Promise<void> {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const uploadsParent = path.dirname(uploadsDir);

  await new Promise<void>((resolve, reject) => {
    const tar = spawn('tar', ['-xzf', archivePath, '-C', uploadsParent], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    // Carry tar's own complaint into the error. A restore that fails is the
    // moment somebody most needs to know WHY, and an exit code alone sends them
    // looking in the wrong place.
    let stderr = '';
    tar.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    tar.on('close', (code: number) => {
      if (code !== 0) {
        const detail = stderr.trim().split('\n').slice(0, 3).join('; ');
        reject(new Error(`tar extraction failed with code ${code}${detail ? `: ${detail}` : ''}`));
      } else {
        resolve();
      }
    });

    tar.on('error', reject);
  });
}

const PSQL_STRICT = ['-v', 'ON_ERROR_STOP=1', '--single-transaction'] as const;

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
      // NOTE: no HTTP surface sets `targetDatabaseUrl`. The admin UI used to
      // offer a field for it and the route's Zod schema silently dropped it, so
      // an administrator who typed another database watched this instance be
      // overwritten instead (audit finding AUD-008). The field is gone; the
      // option stays for callers inside the process, and any future UI for it
      // has to add the schema entry AND show the resolved target before writing.
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
          await spawnRestore('docker', ['exec', '-i', dbContainer, 'psql', ...PSQL_STRICT, '-U', dbInfo.user, dbInfo.database], restoreEnv);
        } catch (_error) {
          // Fallback to direct psql if Docker not available
          await spawnRestore('psql', [...PSQL_STRICT, '-h', dbInfo.host, '-p', dbInfo.port.toString(), '-U', dbInfo.user, dbInfo.database], restoreEnv);
        }
      } else {
        await spawnRestore('psql', [...PSQL_STRICT, '-h', dbInfo.host, '-p', dbInfo.port.toString(), '-U', dbInfo.user, dbInfo.database], restoreEnv);
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
        await extractUploadsArchive(filesBackupPath, uploadsDir);
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
