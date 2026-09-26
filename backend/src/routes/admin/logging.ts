import { Router, Response, NextFunction } from "express";
import { AuthRequest } from "../../middleware/auth";
import {
  getLoggingConfig,
  updateLoggingConfig,
  toggleDebugLogging,
} from "../../services/loggingConfig";
import {
  listLogFiles,
  readLogFile,
  deleteLogFile,
  getLogStats,
  searchLogs,
  resolveLogFile,
  logFileContentType,
} from "../../services/logManager";
import { enforceLogRetention } from "../../services/logRetention";
import {
  loggingConfigSchema,
  toggleDebugLoggingSchema,
  readLogFileQuerySchema,
  searchLogsQuerySchema,
} from "../../schemas/admin";
import type {
  LogCleanupResult,
  LogFilesResponse,
  LoggingConfigResponse,
  LogReadResponse,
  LogStatsResponse,
} from "../../shared/logContract";

/**
 * The admin log area. Bare-family router (see the response-shape ADR): each
 * handler answers the type named in `shared/logContract.ts`, which the admin
 * page reads from the same file's mirror.
 *
 * Errors carry stable codes (`LOG_FILE_INVALID_NAME` 400, `LOG_FILE_NOT_FOUND`
 * 404, `LOG_FILE_UNREADABLE` 500) through the shared error handler.
 */

const router = Router();

router.get("/config", async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const config: LoggingConfigResponse = await getLoggingConfig();
    res.json(config);
  } catch (error) {
    next(error);
  }
});

/** Stores the settings and applies them to the running loggers. */
router.put("/config", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const validated = loggingConfigSchema.parse(req.body);
    const config: LoggingConfigResponse = await updateLoggingConfig(validated);
    res.json({ message: "Logging configuration updated", config });
  } catch (error) {
    next(error);
  }
});

router.post("/toggle-debug", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { enabled } = toggleDebugLoggingSchema.parse(req.body);
    const config: LoggingConfigResponse = await toggleDebugLogging(enabled);
    res.json({ message: `Debug logging ${enabled ? "enabled" : "disabled"}`, config });
  } catch (error) {
    next(error);
  }
});

router.get("/files", async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body: LogFilesResponse = { files: await listLogFiles() };
    res.json(body);
  } catch (error) {
    next(error);
  }
});

/** One page of a file, newest first — plain or gzip. */
router.get("/files/:filename", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const query = readLogFileQuerySchema.parse(req.query);
    const page: LogReadResponse = await readLogFile(req.params.filename, query);
    res.json(page);
  } catch (error) {
    next(error);
  }
});

router.get(
  "/files/:filename/download",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { filename } = req.params;
      const filepath = resolveLogFile(filename);
      res.setHeader("Content-Type", logFileContentType(filename));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.sendFile(filepath, (error) => {
        if (error && !res.headersSent) next(error);
      });
    } catch (error) {
      next(error);
    }
  }
);

router.delete("/files/:filename", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await deleteLogFile(req.params.filename);
    res.json({ message: "Log file deleted" });
  } catch (error) {
    next(error);
  }
});

router.get("/stats", async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const stats: LogStatsResponse = await getLogStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

/** Runs the same retention sweep the daily job runs. */
router.post("/cleanup", async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result: LogCleanupResult = await enforceLogRetention();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/search", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const query = searchLogsQuerySchema.parse(req.query);
    const results = await searchLogs(query);
    res.json({ results, count: results.length, query });
  } catch (error) {
    next(error);
  }
});

export default router;
