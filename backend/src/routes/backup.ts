import { Router, Response, NextFunction } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';
import { prisma } from '../db';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import {
  createBackup,
  listBackups,
  getBackup,
  deleteBackup,
  restoreBackup,
  cleanupOldBackups,
} from '../services/backupService';
import {
  syncToCloud,
  listCloudBackups,
  downloadFromCloud,
  testConnection,
} from '../services/cloudSyncService';
import { serializeBigInt } from '../utils/serializeBigInt';
import { backupRestoreLimiter } from '../middleware/rateLimit';
import { BACKUP_BASE_DIR } from '../services/backup/backupConfig';

const router = Router();

// All routes require authentication and admin privileges
router.use(authenticate);
router.use(requireAdmin);

// Validation schemas
const createBackupSchema = z.object({
  type: z.enum(['full', 'partial']).optional(),
  retentionDays: z.number().int().positive().optional(),
});

const restoreBackupSchema = z.object({
  scope: z.enum(['full', 'database', 'files']),
  createBackupBefore: z.boolean().optional().default(true),
});

// ─── Literal routes (must be defined before parametric /:id routes) ──────────

/**
 * GET /api/v1/backup
 * List all backups
 */
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const backups = await listBackups();
    res.json({ backups: serializeBigInt(backups) });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/backup/status
 * Get current backup status
 */
router.get('/status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const allBackups = await listBackups();
    const running = allBackups.find((b) => b.status === 'running');

    res.json({
      running: !!running,
      currentBackup: running ? serializeBigInt(running) : null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/backup
 * Create a new backup
 */
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = createBackupSchema.parse(req.body);

    // Pre-compute paths so we can store them in the DB record created inside
    // the transaction. BACKUP_BASE_DIR is the service's own constant, so the
    // two cannot disagree.
    const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const precomputedId = `backup-${timestamp}`;
    const backupDir = path.join(BACKUP_BASE_DIR, precomputedId);
    const tempDir = path.join(backupDir, 'temp');
    const dbBackupPath = path.join(tempDir, 'database.sql');
    const filesBackupPath = path.join(tempDir, 'uploads.tar.gz');
    const finalArchivePath = path.join(backupDir, `${precomputedId}.tar.gz`);

    // Atomically check for a running backup AND insert the new 'running' record in one
    // Serializable transaction. This fully closes the TOCTOU window between concurrent
    // POST /backup requests: no second request can sneak past the findFirst check and
    // also insert its own record before ours is visible to the DB.
    await prisma.$transaction(async (tx) => {
      const running = await tx.backup.findFirst({ where: { status: 'running' } });
      if (running) {
        throw new AppError('A backup is already running', 409);
      }

      await tx.backup.create({
        data: {
          id: precomputedId,
          type: body.type || 'full',
          status: 'running',
          backupPath: finalArchivePath,
          dbBackupPath,
          filesBackupPath,
          retentionDays: body.retentionDays || RETENTION_DAYS,
          startedAt: new Date(),
        },
      });
    }, { isolationLevel: 'Serializable' });

    const backupId = await createBackup({
      type: body.type,
      retentionDays: body.retentionDays,
      existingRecord: {
        id: precomputedId,
        backupPath: finalArchivePath,
        dbBackupPath,
        filesBackupPath,
      },
    });

    res.status(201).json({
      success: true,
      backupId,
      message: 'Backup started',
    });
  } catch (error) {
    logger.error({
      operation: 'backup_create_error',
      message: 'Failed to create backup',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
      },
    });
    next(error);
  }
});

/**
 * POST /api/v1/backup/cleanup
 * Cleanup old backups
 */
router.post('/cleanup', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deletedCount = await cleanupOldBackups();
    res.json({
      success: true,
      deletedCount,
      message: `Cleaned up ${deletedCount} old backup(s)`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/backup/cloud/list
 * List backups from WebDAV
 */
router.get('/cloud/list', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const backups = await listCloudBackups();
    res.json({ backups: serializeBigInt(backups) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/backup/cloud/test
 * Test WebDAV connection
 */
router.post('/cloud/test', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/backup/cloud/download
 * Download backup from WebDAV
 */
router.post('/cloud/download', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cloudDownloadSchema = z.object({
      // Only allow simple filenames. This prevents directory traversal like ../../etc/passwd.
      // Backups created by TravStats are `backup-<timestamp>.tar.gz`.
      backupName: z
        .string()
        .min(1)
        .max(255)
        .regex(/^[a-zA-Z0-9._-]+\.tar\.gz$/, 'backupName must be a .tar.gz filename'),
    });

    const { backupName } = cloudDownloadSchema.parse(req.body);
    const sanitized = path.basename(backupName);
    if (sanitized !== backupName) {
      throw new AppError('Invalid backupName', 400);
    }

    // One definition of the backup directory, shared with the service — this
    // copy used to lack the win32 branch its sibling below had.
    const baseDirResolved = path.resolve(BACKUP_BASE_DIR);
    const localPath = path.join(BACKUP_BASE_DIR, sanitized);
    const localPathResolved = path.resolve(localPath);
    if (!localPathResolved.startsWith(baseDirResolved + path.sep)) {
      throw new AppError('Invalid backupName', 400);
    }

    await downloadFromCloud(sanitized, localPathResolved);

    res.json({
      success: true,
      message: 'Backup downloaded from cloud successfully',
      localPath: localPathResolved,
    });
  } catch (error) {
    next(error);
  }
});

// ─── Parametric routes (/:id must come after all literal routes) ──────────────

/**
 * GET /api/v1/backup/:id
 * Get backup details
 */
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const backup = await getBackup(id);
    res.json({ backup: serializeBigInt(backup) });
  } catch (error) {
    // The service throws with its status (forgejo#77); errorHandler reads it.
    next(error);
  }
});

/**
 * GET /api/v1/backup/:id/download
 * Download backup file
 */
router.get('/:id/download', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const backup = await getBackup(id);

    if (backup.status !== 'completed') {
      throw new AppError('Backup is not completed', 400);
    }

    if (!backup.backupPath || !fs.existsSync(backup.backupPath)) {
      throw new AppError('Backup file not found', 404);
    }

    // Path containment check: ensure backupPath is within the expected base directory
    const resolvedPath = path.resolve(backup.backupPath);
    const resolvedBase = path.resolve(BACKUP_BASE_DIR);
    if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
      throw new AppError('Invalid backup path', 400);
    }

    const filename = path.basename(backup.backupPath);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Length', fs.statSync(backup.backupPath).size);

    const fileStream = fs.createReadStream(backup.backupPath);
    fileStream.pipe(res);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/backup/:id/restore
 * Restore backup
 */
router.post('/:id/restore', backupRestoreLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const body = restoreBackupSchema.parse(req.body);

    // Check if there's already a running backup or restore
    const allBackups = await listBackups();
    const running = allBackups.find((b) => b.status === 'running');

    if (running) {
      throw new AppError('A backup operation is already running', 409);
    }

    logger.info({
      operation: 'restore_start',
      message: 'Starting backup restore',
      backupId: id,
      scope: body.scope,
      createBackupBefore: body.createBackupBefore,
    });

    await restoreBackup(id, {
      scope: body.scope,
      createBackupBefore: body.createBackupBefore,
    });

    res.json({
      success: true,
      message: 'Backup restored successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/v1/backup/:id
 * Delete backup
 */
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await deleteBackup(id);
    res.json({
      success: true,
      message: 'Backup deleted successfully',
    });
  } catch (error) {
    // The service throws with its status (forgejo#77); errorHandler reads it.
    next(error);
  }
});

/**
 * POST /api/v1/backup/:id/sync
 * Sync backup to WebDAV
 */
router.post('/:id/sync', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await syncToCloud(id);
    res.json({
      success: true,
      message: 'Backup synced to cloud successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
