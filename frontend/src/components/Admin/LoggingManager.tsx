import { format } from "date-fns";
import { useTranslation } from "../../hooks/useTranslation";

export interface LoggingConfig {
  logLevel: string;
  logHttpRequests: boolean;
  logDatabaseQueries: boolean;
  logParserOperations: boolean;
  maxLogFileSize: number;
  logRetentionDays: number;
}

export interface LogFile {
  filename: string;
  size: number;
  category: string;
  created: string;
  modified: string;
}

export interface LogStats {
  totalSize: number;
  fileCount: number;
  categories: Record<string, { fileCount: number; totalSize: number }>;
  oldestLog: string;
  newestLog: string;
}

interface LoggingManagerProps {
  loggingConfig: LoggingConfig;
  logFiles: LogFile[];
  logStats: LogStats | null;
  savingLogging: boolean;
  onSave: () => void;
  onToggleDebug: () => void;
  onDownload: (filename: string) => void;
  onDelete: (filename: string) => void;
  onCleanup: () => void;
  onLoggingConfigChange: (config: LoggingConfig) => void;
}

export default function LoggingManager({
  loggingConfig,
  logFiles,
  logStats,
  savingLogging,
  onSave,
  onToggleDebug,
  onDownload,
  onDelete,
  onCleanup,
  onLoggingConfigChange,
}: LoggingManagerProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);

  return (
    <div className="space-y-6">
      {/* Header with Quick Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Debug Logging &amp; Diagnostics
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Advanced logging for troubleshooting and monitoring
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onToggleDebug}
            className={`px-4 py-2 rounded-lg transition font-medium ${
              loggingConfig.logLevel === "debug"
                ? "bg-yellow-600 hover:bg-yellow-700 text-white"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {loggingConfig.logLevel === "debug" ? "Disable Debug Mode" : "Enable Debug Mode"}
          </button>
          <button
            onClick={onSave}
            disabled={savingLogging}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg transition font-medium"
          >
            {savingLogging ? t("common:buttons.saving") : t("admin:saveConfig")}
          </button>
        </div>
      </div>

      {/* Debug Mode Warning */}
      {loggingConfig.logLevel === "debug" && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="font-medium text-yellow-900 dark:text-yellow-100">Debug Mode Active</p>
              <p className="text-sm text-yellow-800 dark:text-yellow-200 mt-1">
                Debug logging is enabled with detailed instrumentation. This may impact performance
                and generate large log files. Consider disabling after troubleshooting.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Statistics */}
      {logStats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">Total Log Files</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {logStats.fileCount}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">Total Size</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {(logStats.totalSize / 1024 / 1024).toFixed(2)} MB
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">Oldest Log</div>
            <div className="text-sm font-medium text-gray-900 dark:text-white">
              {(() => {
                try {
                  return logStats.oldestLog
                    ? format(new Date(logStats.oldestLog), "MMM d, yyyy")
                    : "\u2014";
                } catch {
                  return "\u2014";
                }
              })()}
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <div className="text-gray-600 dark:text-gray-400 text-sm mb-1">Newest Log</div>
            <div className="text-sm font-medium text-gray-900 dark:text-white">
              {(() => {
                try {
                  return logStats.newestLog
                    ? format(new Date(logStats.newestLog), "MMM d, yyyy")
                    : "\u2014";
                } catch {
                  return "\u2014";
                }
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Logging Configuration */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          Logging Configuration
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Log Level
            </label>
            <select
              value={loggingConfig.logLevel}
              onChange={(e) =>
                onLoggingConfigChange({ ...loggingConfig, logLevel: e.target.value })
              }
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
            >
              <option value="error">Error (Minimal)</option>
              <option value="warn">Warning</option>
              <option value="info">Info (Default)</option>
              <option value="debug">Debug (Verbose)</option>
              <option value="trace">Trace (Very Verbose)</option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Higher levels include all lower levels (e.g., Debug includes Info, Warn, Error)
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Log Retention (Days)
            </label>
            <input
              type="number"
              min="1"
              max="90"
              value={loggingConfig.logRetentionDays}
              onChange={(e) =>
                onLoggingConfigChange({
                  ...loggingConfig,
                  logRetentionDays: parseInt(e.target.value),
                })
              }
              className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Log files older than this will be automatically deleted
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={loggingConfig.logHttpRequests}
              onChange={(e) =>
                onLoggingConfigChange({ ...loggingConfig, logHttpRequests: e.target.checked })
              }
              className="mt-1 h-4 w-4"
            />
            <div>
              <span className="font-medium text-gray-900 dark:text-white">Log HTTP Requests</span>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Log all HTTP requests with timing, IP, user, and status (category: http)
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={loggingConfig.logDatabaseQueries}
              onChange={(e) =>
                onLoggingConfigChange({ ...loggingConfig, logDatabaseQueries: e.target.checked })
              }
              className="mt-1 h-4 w-4"
            />
            <div>
              <span className="font-medium text-gray-900 dark:text-white">
                Log Database Queries
              </span>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Log SQL queries with args and performance metrics (category: database)
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={loggingConfig.logParserOperations}
              onChange={(e) =>
                onLoggingConfigChange({ ...loggingConfig, logParserOperations: e.target.checked })
              }
              className="mt-1 h-4 w-4"
            />
            <div>
              <span className="font-medium text-gray-900 dark:text-white">
                Log Parser Operations
              </span>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Log LLM operations with provider details (category: parser)
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Log Files */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Log Files</h3>
          <button
            onClick={onCleanup}
            className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition"
          >
            Cleanup Old Logs
          </button>
        </div>
        {logFiles.length === 0 ? (
          <p className="text-gray-600 dark:text-gray-400 text-sm">No log files found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Filename
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Size
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Modified
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {logFiles.map((file) => (
                  <tr key={file.filename}>
                    <td className="px-4 py-3 text-sm font-mono text-gray-900 dark:text-white">
                      {file.filename}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          file.category === "error"
                            ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                            : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                        }`}
                      >
                        {file.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {(file.size / 1024).toFixed(2)} KB
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {format(new Date(file.modified), "MMM d, HH:mm")}
                    </td>
                    <td className="px-4 py-3 text-sm space-x-2">
                      <button
                        onClick={() => onDownload(file.filename)}
                        className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                      >
                        Download
                      </button>
                      <button
                        onClick={() => onDelete(file.filename)}
                        className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
