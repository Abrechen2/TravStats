import { useState } from "react";
import HelpIcon from "../Help/HelpIcon";
import LogViewer from "./LogViewer";
import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import { formatBytes } from "../../lib/fileSize";
import {
  LOG_LEVELS,
  type LogFileInfo,
  type LoggingConfigResponse,
  type LogLevelName,
  type LogStatsResponse,
} from "../../shared/logContract";

export type LoggingConfig = LoggingConfigResponse;
export type LogFile = LogFileInfo;
export type LogStats = LogStatsResponse;

const isLogLevelName = (value: string): value is LogLevelName =>
  (LOG_LEVELS as readonly string[]).includes(value);

const DASH = "\u2014";

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
  const { t, i18n } = useTranslation(["admin", "common"]);
  // Dates follow the user's date format and sizes the UI language — the card
  // printed "Sep 26, 2026" and "3.39 MB" on a German page (browser
  // acceptance 2026-09-26). An unknown date is a dash, never "Invalid Date".
  const fmt = useDisplayFormat();
  const statDate = (iso: string | null): string => (iso ? fmt.date(iso) || DASH : DASH);
  const [viewerFile, setViewerFile] = useState<string | null>(null);
  // `LOG_LEVEL` in the environment pins the level; the picker would only
  // pretend otherwise (see levelPolicy.ts on the server).
  const pinned = loggingConfig.logLevelSource === "environment";
  const verbose =
    loggingConfig.effectiveLogLevel === "debug" || loggingConfig.effectiveLogLevel === "trace";

  return (
    <div className="space-y-6">
      {/* Header with Quick Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-(--text-primary)">
            {t("admin:logging.title")}
          </h2>
          <p className="text-sm text-(--text-muted) mt-1">{t("admin:logging.description")}</p>
          <p className="text-sm mt-1" style={{ color: "var(--warning, #e0921f)" }}>
            {t("admin:logging.help.warning")}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onToggleDebug}
            disabled={pinned}
            className="px-4 py-2 rounded-lg transition font-medium disabled:opacity-50"
            style={{
              background: loggingConfig.logLevel === "debug" ? "var(--warning)" : "var(--accent)",
              color: "#0d1117",
            }}
          >
            {loggingConfig.logLevel === "debug"
              ? t("admin:logging.debugModeDisable")
              : t("admin:logging.debugMode")}
          </button>
          <button
            onClick={onSave}
            disabled={savingLogging}
            className="btn-primary px-4 py-2 font-medium disabled:opacity-50"
          >
            {savingLogging ? t("common:buttons.saving") : t("admin:saveConfig")}
          </button>
        </div>
      </div>

      {/* Debug Mode Warning — about the level in force, not the stored one */}
      {verbose && (
        <div
          className="border rounded-lg p-4"
          style={{ background: "var(--bg-elevated)", borderColor: "var(--color-amber)" }}
        >
          <div className="flex items-start gap-3">
            <svg
              className="w-5 h-5 shrink-0 mt-0.5"
              style={{ color: "var(--color-amber)" }}
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
              <p className="font-medium" style={{ color: "var(--color-amber)" }}>
                {t("admin:logging.debugActive.title")}
              </p>
              <p className="text-sm mt-1" style={{ color: "var(--color-amber)" }}>
                {t("admin:logging.debugActive.message")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Statistics */}
      {logStats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
            <div className="text-(--text-muted) text-sm mb-1">
              {t("admin:logging.stats.totalFiles")}
            </div>
            <div className="text-2xl font-bold text-(--text-primary)">{logStats.fileCount}</div>
          </div>
          <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
            <div className="text-(--text-muted) text-sm mb-1">
              {t("admin:logging.stats.totalSize")}
            </div>
            <div className="text-2xl font-bold text-(--text-primary)">
              {formatBytes(logStats.totalSize, i18n.language)}
            </div>
          </div>
          <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
            <div className="text-(--text-muted) text-sm mb-1">
              {t("admin:logging.stats.oldestLog")}
            </div>
            <div className="text-sm font-medium text-(--text-primary)" data-testid="oldest-log">
              {statDate(logStats.oldestLogAt)}
            </div>
          </div>
          <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
            <div className="text-(--text-muted) text-sm mb-1">
              {t("admin:logging.stats.newestLog")}
            </div>
            <div className="text-sm font-medium text-(--text-primary)" data-testid="newest-log">
              {statDate(logStats.newestLogAt)}
            </div>
          </div>
        </div>
      )}

      {/* Logging Configuration */}
      <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold text-(--text-primary) mb-4">
          {t("admin:logging.configSection")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label
              htmlFor="admin-log-level"
              className="flex items-center gap-1.5 text-sm font-medium text-(--text-primary) mb-2"
            >
              {t("admin:logging.level.label")}
              <HelpIcon content={t("admin:logging.help.levels")} position="top" />
            </label>
            <select
              id="admin-log-level"
              value={loggingConfig.logLevel}
              disabled={pinned}
              onChange={(e) => {
                const level = e.target.value;
                if (isLogLevelName(level))
                  onLoggingConfigChange({ ...loggingConfig, logLevel: level });
              }}
              className="w-full px-3 py-2 bg-(--bg-surface) border border-border rounded-lg text-(--text-primary)"
            >
              <option value="error">{t("admin:logging.level.error")}</option>
              <option value="warn">{t("admin:logging.level.warn")}</option>
              <option value="info">{t("admin:logging.level.info")}</option>
              <option value="debug">{t("admin:logging.level.debug")}</option>
              <option value="trace">{t("admin:logging.level.trace")}</option>
            </select>
            {pinned ? (
              <p
                className="text-xs mt-1"
                style={{ color: "var(--warning, #e0921f)" }}
                data-testid="log-level-pinned"
              >
                {t("admin:logging.level.pinned", { level: loggingConfig.effectiveLogLevel })}
              </p>
            ) : (
              <p className="text-xs text-(--text-muted) mt-1">{t("admin:logging.level.hint")}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-(--text-primary) mb-2">
              {t("admin:logging.retention.label")}
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
              className="w-full px-3 py-2 bg-(--bg-surface) border border-border rounded-lg text-(--text-primary)"
            />
            <p className="text-xs text-(--text-muted) mt-1">{t("admin:logging.retention.hint")}</p>
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-xs text-(--text-muted)">{t("admin:logging.categories.verboseOnly")}</p>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={loggingConfig.logHttpRequests}
              onChange={(e) =>
                onLoggingConfigChange({ ...loggingConfig, logHttpRequests: e.target.checked })
              }
              className="checkbox mt-1"
            />
            <div>
              <span className="font-medium text-(--text-primary)">
                {t("admin:logging.categories.http.label")}
              </span>
              <p className="text-sm text-(--text-muted)">
                {t("admin:logging.categories.http.hint")}
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
              className="checkbox mt-1"
            />
            <div>
              <span className="font-medium text-(--text-primary)">
                {t("admin:logging.categories.database.label")}
              </span>
              <p className="text-sm text-(--text-muted)">
                {t("admin:logging.categories.database.hint")}
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
              className="checkbox mt-1"
            />
            <div>
              <span className="font-medium text-(--text-primary)">
                {t("admin:logging.categories.parser.label")}
              </span>
              <p className="text-sm text-(--text-muted)">
                {t("admin:logging.categories.parser.hint")}
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Log Files */}
      <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-(--text-primary)">
            {t("admin:logging.files.title")}
          </h3>
          <button
            onClick={onCleanup}
            className="text-sm text-white px-3 py-1.5 rounded-lg transition"
            style={{ background: "var(--danger)" }}
          >
            {t("admin:logging.files.cleanup")}
          </button>
        </div>
        {logFiles.length === 0 ? (
          <p className="text-(--text-muted) text-sm">{t("admin:logging.files.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-(--bg-base)">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                    {t("admin:logging.files.colFilename")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                    {t("admin:logging.files.colCategory")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                    {t("admin:logging.files.colSize")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                    {t("admin:logging.files.colModified")}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                    {t("admin:logging.files.colActions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                {logFiles.map((file) => (
                  <tr key={file.filename}>
                    <td className="px-4 py-3 text-sm font-mono text-(--text-primary)">
                      {file.filename}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span
                        className="px-2 py-1 text-xs font-semibold rounded-full"
                        style={
                          file.category === "error"
                            ? { background: "rgba(248,81,73,0.15)", color: "var(--danger)" }
                            : { background: "var(--accent-soft)", color: "var(--accent)" }
                        }
                      >
                        {file.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-(--text-primary)">
                      {formatBytes(file.size, i18n.language)}
                    </td>
                    <td className="px-4 py-3 text-sm text-(--text-primary)">
                      {fmt.dateTime(file.modified) || DASH}
                    </td>
                    <td className="px-4 py-3 text-sm space-x-2">
                      <button
                        onClick={() => setViewerFile(file.filename)}
                        className="text-(--accent) hover:text-(--accent)"
                      >
                        {t("admin:logging.files.view")}
                      </button>
                      <button
                        onClick={() => onDownload(file.filename)}
                        className="text-(--accent) hover:text-(--accent)"
                      >
                        {t("admin:logging.files.download")}
                      </button>
                      <button
                        onClick={() => onDelete(file.filename)}
                        className="text-red-600 hover:text-red-900"
                      >
                        {t("admin:logging.files.delete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LogViewer files={logFiles} selectedFile={viewerFile} onSelectFile={setViewerFile} />
    </div>
  );
}
