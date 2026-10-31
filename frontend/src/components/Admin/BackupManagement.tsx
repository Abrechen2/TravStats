import BackupZoneField from "./BackupZoneField";
import { saveErrorMessage } from "../../lib/saveErrorMessage";
import { useState, useEffect } from "react";
import { backupApi, adminApi } from "../../lib/api";
import type { BackupScheduleSettings } from "../../lib/api/backup";
import { useToastStore } from "../../store/toastStore";
import { profileDateTime } from "../../lib/profileInstant";
import { logger } from "../../lib/logger";
import { apiErrorMachineCode } from "../../lib/apiError";
import { JobLostError, jobErrorCode, waitForJob } from "../../lib/api/jobs";
import {
  backupFailureKey,
  backupRowFailureKey,
  cloudBackupFailureKey,
} from "../../lib/backupFailure";
import { useTranslation } from "../../hooks/useTranslation";
// The shared frame: role=dialog, aria-modal, Escape, focus in and back out,
// and a panel that scrolls instead of running off a 320px screen (AUD-037).
import { RestoreModal } from "./RestoreModal";
export { RestoreModal } from "./RestoreModal";
import type { Backup } from "./backupTypes";
import BackupDeleteModal from "./BackupDeleteModal";
import Toggletip from "../ui/Toggletip";
import { AdminSubBlock } from "./AdminSubBlock";
import CloudBackupList from "./CloudBackupList";

export default function BackupManagement(): JSX.Element {
  const { t } = useTranslation(["admin", "common", "settings"]);
  const addToast = useToastStore((state) => state.addToast);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreModal, setRestoreModal] = useState<Backup | null>(null);
  /** Set when the server refused the last restore over the encryption key.
   *  Cleared whenever the dialog opens or closes, so an acknowledgement can
   *  never carry over to a different archive. */
  const [keyMismatch, setKeyMismatch] = useState(false);
  const [deleteModal, setDeleteModal] = useState<Backup | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [webdavEnabled, setWebdavEnabled] = useState(false);
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
  // The schedule form starts from placeholder defaults. Only a successful GET
  // makes it real: until then it is not shown and Save cannot go out, because
  // saving the placeholders would switch scheduled backups off (forgejo#363).
  const [settingsLoad, setSettingsLoad] = useState<"loading" | "loaded" | "failed">("loading");

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

  const loadBackupSettings = () => {
    setSettingsLoad("loading");
    backupApi
      .getBackupSettings()
      .then((loaded) => {
        setBackupSettings(loaded);
        setSettingsLoad("loaded");
      })
      .catch((err: unknown) => {
        logger.error("Failed to load backup settings", err);
        setSettingsLoad("failed");
      });
  };

  useEffect(() => {
    loadBackupSettings();
  }, []);

  // Whether an upload is even possible here. Without this the retry button
  // would sit on every row of every instance that never configured WebDAV —
  // most of them — and answer 409 to each click. An action that can only fail
  // is not an action.
  useEffect(() => {
    adminApi
      .getWebDAVSettings()
      .then(({ settings }) => setWebdavEnabled(settings.enabled))
      .catch((err: unknown) => logger.error("Failed to load WebDAV settings", err));
  }, []);

  const handleCreateBackup = async () => {
    // A job, not a request held open: the dump takes minutes, and a ten-second
    // timeout used to announce "failed" over a backup that went on to finish.
    try {
      setCreating(true);
      const { jobId } = await backupApi.create({ type: "full" });
      addToast("info", t("admin:backup.toasts.started"));
      void loadBackups();
      await waitForJob(jobId);
      addToast("success", t("admin:backup.toasts.created"));
    } catch (error) {
      logger.error("Failed to create backup:", error);
      addToast(
        "error",
        t(
          error instanceof JobLostError
            ? "admin:backup.toasts.outcomeUnknown"
            : backupFailureKey(error, "admin:backup.toasts.createFailed")
        )
      );
    } finally {
      setCreating(false);
      void loadBackups();
      void loadStatus();
    }
  };

  const handleSaveBackupSettings = async (): Promise<void> => {
    if (settingsLoad !== "loaded") return;
    setSavingSettings(true);
    try {
      const {
        backupEnabled,
        backupInterval,
        backupRetentionDays,
        backupZone,
        backupCloudRetention,
      } = backupSettings;
      const updated = await backupApi.updateBackupSettings({
        backupEnabled,
        backupInterval,
        backupRetentionDays,
        backupCloudRetention: backupCloudRetention ?? false,
        backupZone: backupZone ?? null,
      });
      setBackupSettings(updated);
      addToast("success", t("admin:backup.settingsSaved"));
    } catch (err: unknown) {
      addToast("error", saveErrorMessage(err, t, "admin:backup.settingsFailed"));
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
    acceptEncryptionKeyChange: boolean
  ) => {
    if (!restoreModal) return;

    // The dialog stays open, busy, until the job has an outcome: the admin
    // reads the REAL result — the restore used to report "failed" after ten
    // seconds while it completed, and the retry met a 409.
    setRestoring(true);
    try {
      const { jobId } = await backupApi.restore(restoreModal.id, {
        scope,
        createBackupBefore,
        acceptEncryptionKeyChange,
      });
      await waitForJob(jobId);
      addToast("success", t("admin:backup.toasts.restored"));
      setRestoreModal(null);
      setKeyMismatch(false);
    } catch (error) {
      logger.error("Failed to restore backup:", error);
      // The preflight refusals each say something the generic toast cannot,
      // and two of them are the whole point of refusing: nothing was written.
      // A single "restore failed" over an archive whose credentials merely
      // cannot be decrypted would send the admin looking for a broken file.
      if (error instanceof JobLostError) {
        addToast("error", t("admin:backup.toasts.outcomeUnknown"));
        return;
      }
      switch (jobErrorCode(error) ?? apiErrorMachineCode(error)) {
        case "RESTORE_ENCRYPTION_KEY_MISMATCH":
          // Modal stays open — it now asks for the acknowledgement.
          setKeyMismatch(true);
          break;
        case "RESTORE_ARCHIVE_INCOMPLETE":
          addToast("error", t("admin:backup.restore.archiveIncomplete"));
          break;
        case "RESTORE_ARCHIVE_UNREADABLE":
          addToast("error", t("admin:backup.restore.archiveUnreadable"));
          break;
        case "RESTORE_MIGRATION_FAILED":
          addToast("error", t("admin:backup.restore.migrationFailed"));
          break;
        case "RESTORE_SCHEMA_INCOMPLETE":
          addToast("error", t("admin:backup.restore.schemaIncomplete"));
          break;
        case "RESTORE_ARCHIVE_NEWER":
          addToast("error", t("admin:backup.restore.archiveNewer"));
          break;
        case "RESTORE_ARCHIVE_UNVERSIONED":
        case "RESTORE_ARCHIVE_FAILED_MIGRATION":
          addToast("error", t("admin:backup.restore.archiveUnversioned"));
          break;
        default:
          addToast("error", t(backupFailureKey(error, "admin:backup.toasts.restoreFailed")));
      }
    } finally {
      setRestoring(false);
      void loadBackups();
      void loadStatus();
    }
  };

  /**
   * Retry the upload for one backup.
   *
   * The failure toast carries the SHARE'S OWN WORDS rather than a generic
   * "upload failed": the two states an admin has to tell apart here —
   * "507 Insufficient Storage" and "401 Unauthorized" — are the same sentence
   * otherwise, and this button exists because a tester could not find out why
   * a green connection test produced an empty Nextcloud.
   */
  const handleSync = async (backup: Backup) => {
    setSyncingId(backup.id);
    try {
      await backupApi.syncToCloud(backup.id);
      addToast("success", t("admin:backup.toasts.synced"));
      loadBackups();
    } catch (error) {
      logger.error("Failed to sync backup to cloud:", error);
      // A job's failure is a code worded in the admin's language; only a
      // refusal without one falls back to the share's own words.
      addToast(
        "error",
        error instanceof JobLostError
          ? t("admin:backup.toasts.outcomeUnknown")
          : t(cloudBackupFailureKey(error, "admin:backup.toasts.syncFailed"))
      );
      // The row now carries a reason from the server — show it.
      loadBackups();
    } finally {
      setSyncingId(null);
    }
  };

  const handleDelete = async (backup: Backup, remote: boolean) => {
    setDeleting(true);
    try {
      await backupApi.delete(backup.id, remote);
      setDeleteModal(null);
      addToast("success", t("admin:backup.toasts.deleted"));
    } catch (error) {
      logger.error("Failed to delete backup:", error);
      addToast(
        "error",
        t(remote ? "admin:backup.remoteDeleteFailed" : "admin:backup.toasts.deleteFailed")
      );
    } finally {
      setDeleting(false);
      void loadBackups();
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
      // A backup belongs to no place: the user's profile clock (ADR 0002 Q1).
      return profileDateTime(date) ?? t("common:labels.unknown");
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
      return profileDateTime(date, { seconds: true }) ?? t("common:labels.unknown");
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="t-caption">{t("admin:backup.description")}</p>
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
      <AdminSubBlock
        title={t("admin:backup.schedule.title")}
        aside={
          <button
            onClick={handleSaveBackupSettings}
            disabled={savingSettings || settingsLoad !== "loaded"}
            className="btn-primary px-4 py-2 font-medium text-sm disabled:opacity-50"
          >
            {savingSettings ? t("common:buttons.saving") : t("common:buttons.save")}
          </button>
        }
      >
        <p className="t-caption mb-4">{t("admin:backup.schedule.description")}</p>
        {settingsLoad === "loading" && (
          <div className="text-sm text-muted">{t("common:loading.default")}</div>
        )}
        {settingsLoad === "failed" && (
          <div role="alert" className="flex items-center gap-3 text-sm">
            <span>{t("admin:backup.schedule.loadFailed")}</span>
            <button type="button" onClick={loadBackupSettings} className="btn-secondary px-3 py-1">
              {t("common:buttons.retry")}
            </button>
          </div>
        )}
        {settingsLoad === "loaded" && (
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
            <label className="flex items-start gap-3 mt-3">
              <input
                type="checkbox"
                checked={backupSettings.backupCloudRetention ?? false}
                onChange={(e) =>
                  setBackupSettings({ ...backupSettings, backupCloudRetention: e.target.checked })
                }
              />
              <span>{t("admin:backup.cloudRetention")}</span>
            </label>
            <p className="text-sm text-(--text-muted) mt-2">
              {t("admin:backup.retentionProtection")}
            </p>
            <BackupZoneField
              value={backupSettings.backupZone ?? null}
              effective={backupSettings.backupZoneEffective ?? null}
              hostZone={backupSettings.hostZone ?? null}
              onChange={(zone) => setBackupSettings({ ...backupSettings, backupZone: zone })}
            />
          </div>
        )}
      </AdminSubBlock>

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

      <AdminSubBlock>
        <div className="overflow-x-auto">
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
            <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
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
                      {backup.metadata?.verification === "size" && (
                        <p
                          className="mt-1 max-w-xs whitespace-normal text-xs text-(--text-muted)"
                          title={t("admin:backup.unverifiedHint")}
                        >
                          {t("admin:backup.unverified")}
                        </p>
                      )}
                      {backup.status === "failed" && (
                        <p className="mt-1 max-w-xs whitespace-normal text-xs text-(--text-muted)">
                          {t(backupRowFailureKey(backup.errorCode))}
                        </p>
                      )}
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
                        <Toggletip
                          content={t("admin:backup.cloud.syncedAt", {
                            date: formatDate(backup.cloudSyncAt),
                          })}
                          label={t("admin:backup.cloud.syncedAt", {
                            date: formatDate(backup.cloudSyncAt),
                          })}
                          triggerStyle={{ color: "var(--success)" }}
                        >
                          ✓
                        </Toggletip>
                      ) : backup.cloudSyncError ? (
                        // A failed upload says why. The plain "-" next to a green
                        // connection test is what made this bug unfindable.
                        <Toggletip
                          content={backup.cloudSyncError}
                          triggerStyle={{ color: "var(--danger)" }}
                        >
                          ⚠ {t("admin:backup.cloud.failed")}
                        </Toggletip>
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
                              onClick={() => {
                                setKeyMismatch(false);
                                setRestoreModal(backup);
                              }}
                              className="hover:underline"
                              style={{ color: "var(--warning)" }}
                            >
                              {t("admin:backup.actions.restore")}
                            </button>
                            {backup.cloudDeleteError && (
                              <p role="alert" className="text-sm text-(--danger)">
                                {t(
                                  backup.cloudDeleteError === "REMOTE_TARGET_UNKNOWN"
                                    ? "admin:backup.remoteTargetUnknown"
                                    : "admin:backup.remoteDeleteFailed"
                                )}
                              </p>
                            )}
                            {webdavEnabled &&
                              (!backup.syncedToCloud ||
                                !backup.cloudTarget ||
                                backup.cloudDeleteError === "REMOTE_TARGET_UNKNOWN") && (
                                <button
                                  onClick={() => handleSync(backup)}
                                  disabled={syncingId === backup.id}
                                  className="hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                                  style={{ color: "var(--accent)" }}
                                >
                                  {syncingId === backup.id
                                    ? t("admin:backup.actions.uploading")
                                    : t("admin:backup.actions.upload")}
                                </button>
                              )}
                          </>
                        )}
                        {backup.status !== "running" && (
                          <button
                            onClick={() => setDeleteModal(backup)}
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
      </AdminSubBlock>

      {webdavEnabled && (
        <CloudBackupList
          presentIds={new Set(backups.map((b) => b.id))}
          onDownloaded={() => void loadBackups()}
        />
      )}

      {restoreModal && (
        <RestoreModal
          backup={restoreModal}
          onClose={() => {
            setRestoreModal(null);
            setKeyMismatch(false);
          }}
          onConfirm={handleRestore}
          encryptionKeyMismatch={keyMismatch}
          restoring={restoring}
        />
      )}
      {deleteModal && (
        <BackupDeleteModal
          backup={deleteModal}
          busy={deleting}
          onClose={() => setDeleteModal(null)}
          onConfirm={(remote) => void handleDelete(deleteModal, remote)}
        />
      )}
    </div>
  );
}
