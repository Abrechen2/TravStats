import { useState } from "react";
import { adminApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { formatBytes } from "../../lib/fileSize";
import { logErrorCopy } from "../../components/Admin/logErrorCopy";
import type { ToastType } from "../../store/toastStore";
import type { ConfirmRequest } from "../../hooks/useConfirmDialog";
import type {
  LogFileInfo,
  LoggingConfigResponse,
  LogStatsResponse,
} from "../../shared/logContract";

type Translate = (key: string, options?: Record<string, unknown>) => string;
type AskConfirm = (request: ConfirmRequest) => Promise<boolean>;

/**
 * The admin page's log section: its state and its handlers.
 *
 * Moved out of AdminPage so the toasts it raises can be tested on their own —
 * the cleanup toast read `filesDeleted`/`spaceFreed` while the server sent
 * `deletedCount`, and every admin saw "undefined Dateien gelöscht, NaN MB".
 */
export function useLoggingAdmin(
  t: Translate,
  addToast: (type: ToastType, message: string) => void,
  /** The page's in-page confirm dialog (`useConfirmDialog`), never `window.confirm`. */
  askConfirm: AskConfirm,
  /** UI language, for the freed size in the cleanup toast ("0 B", "3,4 MB"). */
  language = "de"
) {
  const [loggingConfig, setLoggingConfig] = useState<LoggingConfigResponse | null>(null);
  const [logFiles, setLogFiles] = useState<LogFileInfo[]>([]);
  const [logStats, setLogStats] = useState<LogStatsResponse | null>(null);
  const [savingLogging, setSavingLogging] = useState(false);

  const loadLoggingData = async (): Promise<void> => {
    try {
      const [config, files, stats] = await Promise.all([
        adminApi.getLoggingConfig(),
        adminApi.getLogFiles(),
        adminApi.getLogStats(),
      ]);
      setLoggingConfig(config);
      setLogFiles(files.files);
      setLogStats(stats);
    } catch (error) {
      logger.error("Failed to load logging data:", error);
    }
  };

  const handleToggleDebugLogging = async (): Promise<void> => {
    if (!loggingConfig) return;
    const enable = loggingConfig.logLevel !== "debug";
    try {
      await adminApi.toggleDebugLogging(enable);
      await loadLoggingData();
      addToast(
        "success",
        t("admin:toasts.debugLoggingToggled", {
          state: enable ? t("admin:toasts.enabled") : t("admin:toasts.disabled"),
        })
      );
    } catch (error: unknown) {
      logger.error("Failed to toggle debug logging:", error);
      addToast("error", t("admin:toasts.debugLoggingFailed"));
    }
  };

  const handleSaveLoggingConfig = async (): Promise<void> => {
    if (!loggingConfig) return;
    setSavingLogging(true);
    try {
      const { effectiveLogLevel: _effective, logLevelSource: _source, ...stored } = loggingConfig;
      await adminApi.updateLoggingConfig(stored);
      addToast("success", t("admin:toasts.loggingConfigSaved"));
      await loadLoggingData();
    } catch (error: unknown) {
      logger.error("Failed to save logging config:", error);
      addToast("error", t("admin:toasts.loggingConfigFailed"));
    } finally {
      setSavingLogging(false);
    }
  };

  const handleDownloadLogFile = async (filename: string): Promise<void> => {
    try {
      const blob = await adminApi.downloadLogFile(filename);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      logger.error("Failed to download log file:", error);
      addToast("error", logErrorCopy(error, t("admin:toasts.logFileDownloadFailed"), t));
    }
  };

  const handleDeleteLogFile = async (filename: string): Promise<void> => {
    const message = t("admin:prompts.confirmDeleteLog", { filename });
    if (!(await askConfirm({ message, destructive: true }))) return;
    try {
      await adminApi.deleteLogFile(filename);
      addToast("success", t("admin:toasts.logFileDeleted"));
      await loadLoggingData();
    } catch (error: unknown) {
      logger.error("Failed to delete log file:", error);
      addToast("error", logErrorCopy(error, t("admin:toasts.logFileDeletFailed"), t));
    }
  };

  const handleCleanupLogs = async (): Promise<void> => {
    const message = t("admin:prompts.confirmCleanupLogs");
    if (!(await askConfirm({ message, destructive: true }))) return;
    try {
      const result = await adminApi.cleanupLogs();
      addToast(
        "success",
        t("admin:toasts.cleanupComplete", {
          deletedCount: result.deletedCount,
          freed: formatBytes(result.freedBytes, language),
        })
      );
      // A file the sweep could not delete is said, not folded into success.
      if (result.failedCount > 0) {
        addToast("warning", t("admin:toasts.cleanupPartial", { failedCount: result.failedCount }));
      }
      await loadLoggingData();
    } catch (error: unknown) {
      logger.error("Failed to cleanup logs:", error);
      addToast("error", t("admin:toasts.cleanupFailed"));
    }
  };

  return {
    loggingConfig,
    setLoggingConfig,
    logFiles,
    logStats,
    savingLogging,
    loadLoggingData,
    handleToggleDebugLogging,
    handleSaveLoggingConfig,
    handleDownloadLogFile,
    handleDeleteLogFile,
    handleCleanupLogs,
  };
}
