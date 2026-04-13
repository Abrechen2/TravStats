import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../../middleware/auth';
import {
  getLoggingConfig,
  updateLoggingConfig,
  toggleDebugLogging,
  invalidateCacheAndReinit,
} from '../../services/loggingConfig';
import {
  listLogFiles,
  readLogFile,
  deleteLogFile,
  cleanupOldLogs,
  getLogStats,
  searchLogs,
  getLogFilePathForDownload,
} from '../../services/logManager';
import {
  loggingConfigSchema,
  toggleDebugLoggingSchema,
  readLogFileQuerySchema,
  searchLogsQuerySchema,
} from '../../schemas/admin';

const router = Router();

// Get logging configuration
router.get('/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config = await getLoggingConfig();
    res.json(config);
  } catch (error) {
    next(error);
  }
});

// Update logging configuration
router.put('/config', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validatedData = loggingConfigSchema.parse(req.body);
    const updated = await updateLoggingConfig(validatedData);

    // Reinitialize logger streams with new config
    await invalidateCacheAndReinit();

    res.json({
      message: 'Logging configuration updated successfully',
      config: updated,
    });
  } catch (error) {
    next(error);
  }
});

// Toggle debug logging (convenience endpoint)
router.post('/toggle-debug', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { enabled } = toggleDebugLoggingSchema.parse(req.body);
    await toggleDebugLogging(enabled);

    // Reinitialize logger streams with new config
    await invalidateCacheAndReinit();

    res.json({
      message: `Debug logging ${enabled ? 'enabled' : 'disabled'}`,
      debugLoggingEnabled: enabled,
    });
  } catch (error) {
    next(error);
  }
});

// List log files
router.get('/files', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const files = await listLogFiles();
    res.json({ files });
  } catch (error) {
    next(error);
  }
});

// Read specific log file with filters
router.get('/files/:filename', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { filename } = req.params;
    const queryParams = readLogFileQuerySchema.parse(req.query);

    const logs = await readLogFile(filename, queryParams);

    res.json({
      filename,
      entries: logs,
      count: logs.length,
      filters: queryParams,
    });
  } catch (error) {
    next(error);
  }
});

// Download log file
router.get('/files/:filename/download', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { filename } = req.params;
    const filepath = getLogFilePathForDownload(filename);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.download(filepath);
  } catch (error) {
    next(error);
  }
});

// Delete log file
router.delete('/files/:filename', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { filename } = req.params;
    await deleteLogFile(filename);
    res.json({
      message: `Log file ${filename} deleted successfully`,
    });
  } catch (error) {
    next(error);
  }
});

// Get logging statistics
router.get('/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const stats = await getLogStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Cleanup old logs
router.post('/cleanup', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const deletedCount = await cleanupOldLogs();
    res.json({
      message: `Cleanup completed: ${deletedCount} file(s) deleted`,
      deletedCount,
    });
  } catch (error) {
    next(error);
  }
});

// Search logs across all files
router.get('/search', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const queryParams = searchLogsQuerySchema.parse(req.query);
    const results = await searchLogs(queryParams);

    res.json({
      results,
      count: results.length,
      query: queryParams,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
