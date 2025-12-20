import { Router, Response, NextFunction } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
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
import logger from '../utils/logger';

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
  targetDatabaseUrl: z.string().url().optional(),
});

/**
 * GET /api/v1/backup
 * List all backups
 */
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const backups = await listBackups();
    res.json({ backups });
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
    const runningBackup = await getBackup('').catch(() => null);
    
    // Find running backup
    const { listBackups } = await import('../services/backupService');
    const allBackups = await listBackups();
    const running = allBackups.find((b) => b.status === 'running');

    res.json({
      running: !!running,
      currentBackup: running || null,
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
    
    // Check if there's already a running backup
    const { listBackups } = await import('../services/backupService');
    const allBackups = await listBackups();
    const running = allBackups.find((b) => b.status === 'running');

    if (running) {
      throw new AppError('A backup is already running', 409);
    }

    const backupId = await createBackup({
      type: body.type,
      retentionDays: body.retentionDays,
    });

    res.status(201).json({
      success: true,
      backupId,
      message: 'Backup started',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/backup/:id
 * Get backup details
 */
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const backup = await getBackup(id);
    res.json({ backup });
  } catch (error) {
    if (error instanceof Error && error.message === 'Backup not found') {
      next(new AppError('Backup not found', 404));
    } else {
      next(error);
    }
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

    const filename = path.basename(backup.backupPath);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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
router.post('/:id/restore', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const body = restoreBackupSchema.parse(req.body);

    // Check if there's already a running backup or restore
    const { listBackups } = await import('../services/backupService');
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
      targetDatabaseUrl: body.targetDatabaseUrl,
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
    if (error instanceof Error && error.message === 'Backup not found') {
      next(new AppError('Backup not found', 404));
    } else {
      next(error);
    }
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

/**
 * GET /api/v1/backup/cloud/list
 * List backups from WebDAV
 */
router.get('/cloud/list', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const backups = await listCloudBackups();
    res.json({ backups });
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
    const { backupName } = req.body;
    if (!backupName) {
      throw new AppError('backupName is required', 400);
    }

    const BACKUP_BASE_DIR = process.env.BACKUP_PATH || '/app/data/backups';
    const localPath = path.join(BACKUP_BASE_DIR, backupName);

    await downloadFromCloud(backupName, localPath);

    res.json({
      success: true,
      message: 'Backup downloaded from cloud successfully',
      localPath,
    });
  } catch (error) {
    next(error);
  }
});

export default router;



