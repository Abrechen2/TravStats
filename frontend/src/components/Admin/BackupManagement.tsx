import { useState, useEffect } from "react";
import { backupApi } from "../../lib/api";
import type { BackupScheduleSettings } from "../../lib/api/backup";
import { useToastStore } from "../../store/toastStore";
import { format } from "date-fns";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";

interface Backup {
  id: string;
  type: string;
  status: string;
  backupPath: string;
  size: string;
  retentionDays: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  syncedToCloud: boolean;
  cloudSyncAt: string | null;
  createdAt: string;
  fileExists?: boolean;
}

interface RestoreModalProps {
  backup: Backup;
  onClose: () => void;
  onConfirm: (
    scope: "full" | "database" | "files",
    createBackupBefore: boolean,
    targetDatabaseUrl?: string
  ) => void;
}

function RestoreModal({ backup, onClose, onConfirm }: RestoreModalProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const [scope, setScope] = useState<"full" | "database" | "files">("full");
  const [createBackupBefore, setCreateBackupBefore] = useState(true);
  const [targetDatabaseUrl, setTargetDatabaseUrl] = useState("");
  const [confirmText, setConfirmText] = useState("");

  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return t("common:labels.unknown");
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return t("common:labels.unknown");
      }
      return format(date, "dd.MM.yyyy HH:mm");
    } catch {
      return t("common:labels.unknown");
    }
  };

  const handleConfirm = () => {
    if (confirmText !== t("admin:backup.restore.confirmText")) {
      return;
    }
    onConfirm(scope, createBackupBefore, targetDatabaseUrl || undefined);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-(--bg-surface) rounded-lg shadow-xl max-w-2xl w-full mx-4 p-6">
        <h2 className="text-2xl font-bold mb-4" style={{ color: "var(--danger)" }}>
          ⚠️ {t("admin:backup.restore.title")}
        </h2>

        <div className="space-y-4 mb-6">
          <div
            className="border rounded-lg p-4"
            style={{ background: "var(--bg-elevated)", borderColor: "var(--danger)" }}
          >
            <p className="font-semibold" style={{ color: "var(--danger)" }}>
              {t("admin:backup.restore.warning")}
            </p>
            <p className="text-sm mt-2" style={{ color: "var(--danger)" }}>
              {t("admin:backup.restore.backupFrom", { date: formatDate(backup.completedAt) })}
            </p>
          </div>

          <div>
            <label className="label">{t("admin:backup.restore.scope")}</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "full" | "database" | "files")}
              className="input"
            >
              <option value="full">{t("admin:backup.restore.scopeFull")}</option>
              <option value="database">{t("admin:backup.restore.scopeDatabase")}</option>
              <option value="files">{t("admin:backup.restore.scopeFiles")}</option>
            </select>
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={createBackupBefore}
              onChange={(e) => setCreateBackupBefore(e.target.checked)}
              className="checkbox"
            />
            <span>{t("admin:backup.restore.createBackupBefore")}</span>
          </label>

          <div>
            <label className="label">{t("admin:backup.restore.targetDatabaseUrl")}</label>
            <input
              type="text"
              value={targetDatabaseUrl}
              onChange={(e) => {
                const value = e.target.value;
                // Validate URL format if provided
                if (value) {
                  try {
                    // Use URL class for robust validation
                    const testUrl = value.replace(/^postgresql:\/\//, "http://");
                    new URL(testUrl);
                    setTargetDatabaseUrl(value);
                  } catch {
                    // Invalid URL format - don't update
                    return;
                  }
                } else {
                  setTargetDatabaseUrl(value);
                }
              }}
              placeholder={t("admin:backup.restore.targetDatabaseUrlPlaceholder")}
              className="input"
            />
            <p className="text-sm text-(--text-muted) mt-1">
              {t("admin:backup.restore.targetDatabaseUrlHelp")}
            </p>
          </div>

          <div>
            <label className="label">
              {t("admin:backup.restore.confirmLabel", {
                text: t("admin:backup.restore.confirmText"),
              })}
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="input"
              placeholder={t("admin:backup.restore.confirmText")}
            />
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="btn-secondary">
            {t("common:buttons.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirmText !== t("admin:backup.restore.confirmText")}
            className="btn-danger disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("admin:backup.restore.confirmButton")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BackupManagement(): JSX.Element {
  const { t } = useTranslation(["admin", "common", "settings"]);
  const addToast = useToastStore((state) => state.addToast);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoreModal, setRestoreModal] = useState<Backup | null>(null);
  const [status, setStatus] = useState<{
    running: boolean;
    currentBackup: { id: string; status: string; startedAt: string | null } | null;
  } | null>(null);
  const [backupSettings, setBackupSettings] = useState<BackupScheduleSettings>({
    backupEnabled: false,
    backupInterval: "weekly",
    backupRetentionDays: 30,
  });
  const [savingSettings, setSavingSettings] = useState(false);

  // showLoading is only set on the initial mount. The 5s poll and the
  // post-action refreshes (create/restore/delete) refresh silently — a
  // full-page loading flip on every poll blanks the table and resets the
  // scroll position (bug #180).
  const loadBackups = async ({ showLoading = false }: { showLoading?: boolean } = {}) => {
    try {
      if (showLoading) setLoading(true);
      const data = await backupApi.list();
      setBackups(data.backups);
    } catch (error) {
      logger.error("Failed to load backups:", error);
      addToast("error", t("admin:backup.toasts.loadFailed"));
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const loadStatus = async () => {
    try {
      const data = await backupApi.getStatus();
      setStatus(data);
    } catch (error) {
      logger.error("Failed to load backup status:", error);
    }
  };

  useEffect(() => {
    loadBackups({ showLoading: true });
    loadStatus();
    const interval = setInterval(() => {
      loadBackups();
      loadStatus();
    }, 5000); // Refresh every 5 seconds (silent — no full-page loading flip)
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    backupApi
      .getBackupSettings()
      .then(setBackupSettings)
      .catch((err: unknown) => logger.error("Failed to load backup settings", err));
  }, []);

  const handleCreateBackup = async () => {
    try {
      setCreating(true);
      await backupApi.create({ type: "full" });
      addToast("success", t("admin:backup.toasts.started"));
      setTimeout(() => {
        loadBackups();
        loadStatus();
      }, 1000);
    } catch (error) {
      logger.error("Failed to create backup:", error);
      addToast("error", t("admin:backup.toasts.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const handleSaveBackupSettings = async (): Promise<void> => {
    setSavingSettings(true);
    try {
      const updated = await backupApi.updateBackupSettings(backupSettings);
      setBackupSettings(updated);
      addToast("success", t("admin:backup.settingsSaved"));
    } catch (err: unknown) {
      addToast("error", t("admin:backup.settingsFailed"));
      logger.error("Failed to save backup settings", err);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDownload = async (backup: Backup) => {
    try {
      const blob = await backupApi.download(backup.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `backup-${backup.id}.tar.gz`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      addToast("success", t("admin:backup.toasts.downloading"));
    } catch (error) {
      logger.error("Failed to download backup:", error);
      addToast("error", t("admin:backup.toasts.downloadFailed"));
    }
  };

  const handleRestore = async (
    scope: "full" | "database" | "files",
    createBackupBefore: boolean,
    targetDatabaseUrl?: string
  ) => {
    if (!restoreModal) return;

    try {
      await backupApi.restore(restoreModal.id, {
        scope,
        createBackupBefore,
        targetDatabaseUrl,
      });
      addToast("success", t("admin:backup.toasts.restoring"));
      setRestoreModal(null);
      setTimeout(() => {
        loadBackups();
        loadStatus();
      }, 2000);
    } catch (error) {
      logger.error("Failed to restore backup:", error);
      addToast("error", t("admin:backup.toasts.restoreFailed"));
    }
  };

  const handleDelete = async (backup: Backup) => {
    if (!confirm(t("admin:backup.deleteConfirm", { date: formatDate(backup.completedAt) }))) {
      return;
    }

    try {
      await backupApi.delete(backup.id);
      addToast("success", t("admin:backup.toasts.deleted"));
      loadBackups();
    } catch (error) {
      logger.error("Failed to delete backup:", error);
      addToast("error", t("admin:backup.toasts.deleteFailed"));
    }
  };

  const formatSize = (bytes: string) => {
    const size = parseInt(bytes, 10);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return t("common:labels.unknown");
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return t("common:labels.unknown");
      }
      return format(date, "dd.MM.yyyy HH:mm");
    } catch (error) {
      logger.warn("Failed to format date:", dateString, error);
      return t("common:labels.unknown");
    }
  };

  const formatDateTime = (dateString: string | null | undefined): string => {
    if (!dateString) return t("common:labels.unknown");
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return t("common:labels.unknown");
      }
      return format(date, "dd.MM.yyyy HH:mm:ss");
    } catch (error) {
      logger.warn("Failed to format date:", dateString, error);
      return t("common:labels.unknown");
    }
  };

  // Status colour comes from brand state tokens, not raw Tailwind hexes.
  // Returns the inline-style object instead of a class so the consumer
  // applies it via `style={getStatusStyle(...)}`.
  const getStatusStyle = (status: string): { color: string } => {
    switch (status) {
      case "completed":
        return { color: "var(--success)" };
      case "running":
        return { color: "var(--accent)" };
      case "failed":
        return { color: "var(--danger)" };
      default:
        return { color: "var(--text-muted)" };
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "completed":
        return t("admin:backup.status.completed");
      case "running":
        return t("admin:backup.status.running");
      case "failed":
        return t("admin:backup.status.failed");
      case "pending":
        return t("admin:backup.status.pending");
      default:
        return status;
    }
  };

  if (loading) {
    return <div className="text-center py-8">{t("admin:backup.loading")}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-(--text-primary)">{t("admin:backup.title")}</h2>
          <p className="text-sm text-(--text-muted) mt-1">{t("admin:backup.description")}</p>
        </div>
        <button
          onClick={handleCreateBackup}
          disabled={creating || status?.running}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating
            ? t("admin:backup.creating")
            : status?.running
              ? t("admin:backup.running")
              : t("admin:backup.createNow")}
        </button>
      </div>

      {/* Backup Schedule Settings */}
      <div className="bg-(--bg-surface) rounded-lg shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-(--text-primary)">
              {t("admin:backup.schedule.title")}
            </h3>
            <p className="text-sm text-(--text-muted) mt-1">
              {t("admin:backup.schedule.description")}
            </p>
          </div>
          <button
            onClick={handleSaveBackupSettings}
            disabled={savingSettings}
            className="btn-primary px-4 py-2 font-medium text-sm disabled:opacity-50"
          >
            {savingSettings ? t("common:buttons.saving") : t("common:buttons.save")}
          </button>
        </div>
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={backupSettings.backupEnabled}
              onChange={(e) =>
                setBackupSettings({ ...backupSettings, backupEnabled: e.target.checked })
              }
              className="w-4 h-4 rounded-sm"
            />
            <span className="text-sm font-medium text-(--text-primary)">
              {t("admin:backup.schedule.enableAutoBackup")}
            </span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-(--text-primary) mb-1">
                {t("admin:backup.schedule.interval")}
              </label>
              <select
                value={backupSettings.backupInterval}
                onChange={(e) =>
                  setBackupSettings({
                    ...backupSettings,
                    backupInterval: e.target.value as BackupScheduleSettings["backupInterval"],
                  })
                }
                disabled={!backupSettings.backupEnabled}
                className="input w-full disabled:opacity-50"
              >
                <option value="daily">{t("settings:backup.intervals.daily")}</option>
                <option value="weekly">{t("settings:backup.intervals.weekly")}</option>
                <option value="monthly">{t("settings:backup.intervals.monthly")}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-(--text-primary) mb-1">
                {t("admin:backup.schedule.retentionDays")}
              </label>
              <input
                type="number"
                value={backupSettings.backupRetentionDays}
                onChange={(e) =>
                  setBackupSettings({
                    ...backupSettings,
                    backupRetentionDays: parseInt(e.target.value, 10) || 30,
                  })
                }
                min="1"
                max="365"
                className="input w-full"
              />
            </div>
          </div>
        </div>
      </div>

      {status?.running && status.currentBackup && (
        <div
          className="border rounded-lg p-4"
          style={{ background: "var(--bg-elevated)", borderColor: "#60a5fa" }}
        >
          <p style={{ color: "#2563eb" }}>
            <strong>{t("admin:backup.running")}:</strong>{" "}
            {t("admin:backup.startedAt", { date: formatDateTime(status.currentBackup.startedAt) })}
          </p>
        </div>
      )}

      <div className="bg-(--bg-surface) rounded-lg shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y" style={{ borderColor: "var(--color-border)" }}>
          <thead className="bg-(--bg-base)">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                {t("admin:backup.table.date")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                {t("admin:backup.table.status")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                {t("admin:backup.table.size")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                {t("admin:backup.table.type")}
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                {t("admin:backup.table.cloud")}
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-(--text-muted) uppercase tracking-wider">
                {t("common:labels.actions")}
              </th>
            </tr>
          </thead>
          <tbody
            className="bg-(--bg-surface) divide-y"
            style={{ borderColor: "var(--color-border)" }}
          >
            {backups.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-4 text-center text-(--text-muted)">
                  {t("admin:backup.noBackups")}
                </td>
              </tr>
            ) : (
              backups.map((backup) => (
                <tr key={backup.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-(--text-primary)">
                    {formatDate(backup.completedAt || backup.startedAt)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium" style={getStatusStyle(backup.status)}>
                      {getStatusText(backup.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-(--text-muted)">
                    {backup.status === "completed" ? formatSize(backup.size) : "-"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-(--text-muted)">
                    {backup.type === "full"
                      ? t("admin:backup.type.full")
                      : t("admin:backup.type.partial")}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-(--text-muted)">
                    {backup.syncedToCloud ? (
                      <span style={{ color: "var(--success)" }}>✓</span>
                    ) : (
                      <span className="text-(--text-muted)">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      {backup.status === "completed" && backup.fileExists !== false && (
                        <>
                          <button
                            onClick={() => handleDownload(backup)}
                            className="hover:underline"
                            style={{ color: "var(--accent)" }}
                          >
                            {t("admin:backup.actions.download")}
                          </button>
                          <button
                            onClick={() => setRestoreModal(backup)}
                            className="hover:underline"
                            style={{ color: "var(--warning)" }}
                          >
                            {t("admin:backup.actions.restore")}
                          </button>
                        </>
                      )}
                      {backup.status !== "running" && (
                        <button
                          onClick={() => handleDelete(backup)}
                          className="hover:underline"
                          style={{ color: "var(--danger)" }}
                        >
                          {t("common:buttons.delete")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {restoreModal && (
        <RestoreModal
          backup={restoreModal}
          onClose={() => setRestoreModal(null)}
          onConfirm={handleRestore}
        />
      )}
    </div>
  );
}
