import { useCallback, useEffect, useState, type JSX } from "react";
import { backupApi } from "../../lib/api";
import { JobLostError, waitForJob } from "../../lib/api/jobs";
import {
  backupFailureKey,
  backupRowFailureKey,
  cloudBackupFailureKey,
} from "../../lib/backupFailure";
import { profileDateTime } from "../../lib/profileInstant";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import CloudBackupList from "../Admin/CloudBackupList";
import type { Backup } from "../Admin/backupTypes";
import { useDialogCopy, useRowCopy } from "../Settings/rowCopy";
import Button from "../ui/Button";
import {
  ActionControl,
  ConfirmDialog,
  ErrorLine,
  JobStatus,
  SettingItem,
  useGuardedNavigate,
  type JobView,
} from "../ui/settings";
import BackupsSummary from "./BackupsSummary";
import { MenuItem, RowMenu } from "./RowMenu";
import { restoreOutcome, type RestoreOutcome } from "./restoreFailure";
import { useWebdavEnabled } from "./useWebdavEnabled";

/** While a backup runs the list must follow it closely; idle, only a scheduled one changes it. */
export const BACKUP_POLL_BUSY_MS = 5000;
export const BACKUP_POLL_IDLE_MS = 30000;

type Scope = "full" | "database" | "files";
type Status = { running: boolean } | null;

const formatSize = (bytes: string): string => {
  const size = parseInt(bytes, 10);
  if (!Number.isFinite(size)) return "–";
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
};

/**
 * Backups › Vorhandene Sicherungen (design C6): "Jetzt sichern" as a job, the
 * list with its row actions, and the copies on WebDAV. Restoring and deleting
 * go through the confirmation block (restoring with the word typed); every
 * failure names its cause — a restore the server refused says so and that
 * nothing was written.
 */
export default function BackupsExisting(): JSX.Element {
  const { t } = useTranslation(["settingsRows", "admin", "common", "settings"]);
  const go = useGuardedNavigate();
  const row = useRowCopy("backups");
  const dialog = useDialogCopy();
  const addToast = useToastStore((s) => s.addToast);
  const { enabled: webdav, failed: webdavFailed, retry: retryWebdav } = useWebdavEnabled();
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [listFailed, setListFailed] = useState(false);
  const [job, setJob] = useState<JobView | null>(null);
  const [creating, setCreating] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [restore, setRestore] = useState<{ backup: Backup; scope: Scope } | null>(null);
  const [acceptKey, setAcceptKey] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState<RestoreOutcome | null>(null);
  const [removing, setRemoving] = useState<Backup | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [list, st] = await Promise.all([backupApi.list(), backupApi.getStatus()]);
      setBackups(list.backups as Backup[]);
      setStatus(st);
      setListFailed(false);
    } catch (error) {
      logger.error("Failed to load backups:", error);
      setListFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Fast only while a backup runs, slowly otherwise, not at all while the tab is hidden.
  const busy = status?.running === true || creating || restoring;
  useEffect(() => {
    const refresh = (): void => {
      if (document.visibilityState !== "hidden") void load();
    };
    const timer = setInterval(refresh, busy ? BACKUP_POLL_BUSY_MS : BACKUP_POLL_IDLE_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [busy, load]);

  const when = (iso: string | null | undefined): string => {
    if (!iso) return t("common:labels.unknown");
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? t("common:labels.unknown")
      : (profileDateTime(date) ?? t("common:labels.unknown"));
  };

  const create = async (): Promise<void> => {
    setCreating(true);
    setRowError(null);
    setJob({ kind: "waiting" });
    try {
      // A job, not a request held open: the dump takes minutes.
      const { jobId } = await backupApi.create({ type: "full" });
      setJob({ kind: "running", what: t("settingsRows:backups.job.running") });
      void load();
      await waitForJob(jobId);
      setJob({ kind: "done", result: t("settingsRows:backups.job.done") });
    } catch (error) {
      logger.error("Failed to create backup:", error);
      setJob(
        error instanceof JobLostError
          ? { kind: "unknown", onCheck: () => void load() }
          : {
              kind: "failed",
              reason: t(backupFailureKey(error, "admin:backup.toasts.createFailed")),
              onRetry: () => void create(),
            }
      );
    } finally {
      setCreating(false);
      void load();
    }
  };

  const download = async (backup: Backup): Promise<void> => {
    setRowError(null);
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
    } catch (error) {
      logger.error("Failed to download backup:", error);
      setRowError(t("settingsRows:backups.errors.download"));
    }
  };

  const upload = async (backup: Backup): Promise<void> => {
    setSyncingId(backup.id);
    setRowError(null);
    try {
      await backupApi.syncToCloud(backup.id);
      addToast("success", t("admin:backup.toasts.synced"));
    } catch (error) {
      logger.error("Failed to sync backup to cloud:", error);
      setRowError(
        t(
          error instanceof JobLostError
            ? "admin:backup.toasts.outcomeUnknown"
            : cloudBackupFailureKey(error, "admin:backup.toasts.syncFailed")
        )
      );
    } finally {
      setSyncingId(null);
      void load();
    }
  };

  const runRestore = async (accept: boolean): Promise<void> => {
    if (!restore) return;
    setRestoring(true);
    setRestoreFailed(null);
    try {
      const { jobId } = await backupApi.restore(restore.backup.id, {
        scope: restore.scope,
        createBackupBefore: true,
        acceptEncryptionKeyChange: accept,
      });
      await waitForJob(jobId);
      addToast("success", t("settingsRows:backups.restored"));
      setRestore(null);
      setAcceptKey(false);
    } catch (error) {
      logger.error("Failed to restore backup:", error);
      const outcome = restoreOutcome(error);
      // The key refusal is a question, not an error: nothing was written, and the
      // admin decides whether to go on without the services' credentials.
      if (outcome === "keyMismatch") setAcceptKey(true);
      else {
        setRestore(null);
        setRestoreFailed(outcome);
      }
    } finally {
      setRestoring(false);
      void load();
    }
  };

  const remove = async (): Promise<void> => {
    if (!removing) return;
    setRemoveBusy(true);
    setRowError(null);
    try {
      // The WebDAV copy goes with it when the schedule's "also clean up" switch is on.
      const { backupCloudRetention } = await backupApi.getBackupSettings();
      await backupApi.delete(removing.id, Boolean(backupCloudRetention) && removing.syncedToCloud);
      setRemoving(null);
    } catch (error) {
      logger.error("Failed to delete backup:", error);
      setRemoving(null);
      setRowError(t("settingsRows:backups.errors.delete"));
    } finally {
      setRemoveBusy(false);
      void load();
    }
  };

  const now = row("bakjetzt");
  const list = row("bakliste");
  const fetchRow = row("bakwdload");
  const scopeAmount = (scope: Scope): string => t(`settingsRows:backups.restoreScope.${scope}`);
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <BackupsSummary backups={backups} />
      <SettingItem
        title={now.title}
        scope="allAccounts"
        job={job ? <JobStatus job={job} /> : undefined}
        control={
          <ActionControl
            label={t("settingsRows:backups.now")}
            busy={creating || status?.running === true}
            onClick={() => void create()}
          />
        }
      />
      <SettingItem title={list.title} help={list.help} scope="allAccounts">
        {listFailed ? (
          <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
            <ErrorLine>{t("settingsRows:backups.errors.list")}</ErrorLine>
            <Button variant="secondary" onClick={() => void load()}>
              {t("settingsRows:server.retry")}
            </Button>
          </div>
        ) : null}
        {rowError ? <ErrorLine>{rowError}</ErrorLine> : null}
        {backups && backups.length === 0 && !listFailed ? (
          <p className="t-caption" style={{ margin: 0 }}>
            {t("settingsRows:backups.empty")}
          </p>
        ) : null}
        <ul className="flex flex-col" style={{ margin: 0, padding: 0 }}>
          {(backups ?? []).map((backup) => {
            const usable = backup.status === "completed" && backup.fileExists !== false;
            return (
              <li
                key={backup.id}
                className="flex flex-wrap items-center"
                style={{
                  listStyle: "none",
                  gap: "var(--ts-space-md)",
                  padding: "var(--ts-space-md) 0",
                  borderTop: "1px solid var(--ts-border)",
                }}
              >
                <span className="flex min-w-0 flex-col" style={{ flex: "1 1 220px" }}>
                  <span style={{ color: "var(--ts-text-bright)", fontWeight: 600 }}>
                    {when(backup.completedAt || backup.startedAt)}
                  </span>
                  <span className="t-caption">
                    {t(`admin:backup.status.${backup.status}`, { defaultValue: backup.status })}
                    {backup.status === "completed" ? ` · ${formatSize(backup.size)}` : ""}
                    {backup.syncedToCloud ? ` · ${t("settingsRows:backups.onWebdav")}` : ""}
                  </span>
                  {backup.status === "failed" ? (
                    <span className="t-caption" style={{ color: "var(--ts-warn)" }}>
                      {t(backupRowFailureKey(backup.errorCode))}
                    </span>
                  ) : null}
                  {backup.cloudSyncError && !backup.syncedToCloud ? (
                    <span className="t-caption" style={{ color: "var(--ts-warn)" }}>
                      {t("settingsRows:backups.webdavFailed")}
                    </span>
                  ) : null}
                  {backup.metadata?.verification === "size" ? (
                    <span className="t-caption">{t("admin:backup.unverified")}</span>
                  ) : null}
                </span>
                <RowMenu
                  label={t("settingsRows:backups.menu", {
                    date: when(backup.completedAt || backup.startedAt),
                  })}
                >
                  {(close) => (
                    <>
                      {usable ? (
                        <>
                          <MenuItem
                            onClick={() => {
                              close();
                              void download(backup);
                            }}
                          >
                            {t("admin:backup.actions.download")}
                          </MenuItem>
                          {webdav === true && !backup.syncedToCloud ? (
                            <MenuItem
                              onClick={() => {
                                close();
                                void upload(backup);
                              }}
                            >
                              {syncingId === backup.id
                                ? t("admin:backup.actions.uploading")
                                : t("admin:backup.actions.upload")}
                            </MenuItem>
                          ) : null}
                          {(["full", "database", "files"] as const).map((scope) => (
                            <MenuItem
                              key={scope}
                              onClick={() => {
                                close();
                                setRestoreFailed(null);
                                setAcceptKey(false);
                                setRestore({ backup, scope });
                              }}
                            >
                              {t(`settingsRows:backups.restoreAction.${scope}`)}
                            </MenuItem>
                          ))}
                        </>
                      ) : null}
                      {backup.status !== "running" ? (
                        <MenuItem
                          danger
                          onClick={() => {
                            close();
                            setRemoving(backup);
                          }}
                        >
                          {t("common:buttons.delete")}
                        </MenuItem>
                      ) : null}
                    </>
                  )}
                </RowMenu>
              </li>
            );
          })}
        </ul>
      </SettingItem>
      {webdavFailed && webdav === null ? (
        <ErrorLine>
          {t("settingsRows:backups.errors.webdavStatus")}{" "}
          <button type="button" className="t-caption underline" onClick={retryWebdav}>
            {t("settingsRows:backups.retry")}
          </button>
        </ErrorLine>
      ) : null}
      {webdav === true ? (
        <SettingItem title={fetchRow.title} sub={fetchRow.sub} scope="allAccounts">
          <CloudBackupList
            presentIds={new Set((backups ?? []).map((b) => b.id))}
            onDownloaded={() => void load()}
          />
        </SettingItem>
      ) : null}
      {webdav === false ? (
        // Fetching from WebDAV needs a WebDAV target: the row says so and goes to the service.
        <SettingItem
          title={fetchRow.title}
          sub={fetchRow.sub}
          scope="allAccounts"
          dependency={{
            reason: t("settings:blocks.dep.noWebdav.reason"),
            jump: {
              label: t("settings:blocks.dep.noWebdav.jump"),
              onJump: () => go("/settings/dienste?service=webdav"),
            },
          }}
        />
      ) : null}
      {restoreFailed ? (
        <ErrorLine>{t(`settingsRows:backups.restoreFailure.${restoreFailed}`)}</ErrorLine>
      ) : null}
      {restore && !acceptKey ? (
        <ConfirmDialog
          open
          {...dialog("restore", { date: when(restore.backup.completedAt) })}
          amount={scopeAmount(restore.scope)}
          busy={restoring}
          onCancel={() => setRestore(null)}
          onConfirm={() => void runRestore(false)}
        />
      ) : null}
      {restore && acceptKey ? (
        <ConfirmDialog
          open
          {...dialog("restorekey", { date: when(restore.backup.completedAt) })}
          busy={restoring}
          onCancel={() => {
            setRestore(null);
            setAcceptKey(false);
          }}
          onConfirm={() => void runRestore(true)}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          open
          {...dialog("bakdel", {
            date: when(removing.completedAt || removing.startedAt),
            size: removing.status === "completed" ? formatSize(removing.size) : "–",
          })}
          busy={removeBusy}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove()}
        />
      ) : null}
    </div>
  );
}
