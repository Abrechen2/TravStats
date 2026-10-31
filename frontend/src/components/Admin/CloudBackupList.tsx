import { useState } from "react";

import { backupApi } from "../../lib/api";
import { JobLostError } from "../../lib/api/jobs";
import { logger } from "../../lib/logger";
import { cloudBackupFailureKey } from "../../lib/backupFailure";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { AdminSubBlock } from "./AdminSubBlock";

interface Props {
  /** Ids already in the backup list; their share copy cannot be fetched again. */
  presentIds: ReadonlySet<string>;
  /** Called after a backup has been added, so the list above can reload. */
  onDownloaded: () => void;
}

interface Remote {
  name: string;
  size: number;
}

/**
 * The backups that sit on the WebDAV share, with a button to bring one back
 * into the backup list (e.g. after moving servers). Until now a downloaded
 * file landed on disk with no row, so it could be neither seen nor restored.
 *
 * One transfer at a time on this screen, as on the server (409 otherwise):
 * every other button is disabled while one runs.
 */
export default function CloudBackupList({ presentIds, onDownloaded }: Props): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const addToast = useToastStore((state) => state.addToast);
  const [remote, setRemote] = useState<Remote[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const { backups } = await backupApi.listCloudBackups();
      setRemote(backups.map(({ name, size }) => ({ name, size })));
    } catch (error) {
      logger.error("Failed to list backups on the WebDAV share:", error);
      setRemote(null);
      setLoadFailed(true);
      addToast("error", t(cloudBackupFailureKey(error, "admin:backup.cloudList.loadFailed")));
    } finally {
      setLoading(false);
    }
  };

  const download = async (name: string) => {
    setDownloading(name);
    setPercent(null);
    try {
      const result = await backupApi.downloadFromCloud(name, (done, total) =>
        setPercent(total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : null)
      );
      addToast(
        "success",
        t(result.verified ? "admin:backup.cloudList.done" : "admin:backup.cloudList.doneUnverified")
      );
      onDownloaded();
    } catch (error) {
      logger.error("Failed to download backup from the WebDAV share:", error);
      addToast(
        "error",
        error instanceof JobLostError
          ? t("admin:backup.toasts.outcomeUnknown")
          : t(cloudBackupFailureKey(error, "admin:backup.toasts.downloadFailed"))
      );
    } finally {
      setDownloading(null);
      setPercent(null);
    }
  };

  return (
    <AdminSubBlock>
      <h3 className="text-base font-semibold text-(--text-primary)">
        {t("admin:backup.cloudList.title")}
      </h3>
      <p className="mt-1 text-sm text-(--text-muted)">{t("admin:backup.cloudList.description")}</p>
      <button
        onClick={() => void load()}
        disabled={loading || downloading !== null}
        className="mt-3 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ color: "var(--accent)" }}
      >
        {loading ? t("admin:backup.cloudList.loading") : t("admin:backup.cloudList.load")}
      </button>
      {loadFailed && (
        <p role="alert" className="mt-2 text-sm text-(--danger)">
          {t("admin:backup.cloudList.loadFailed")}
        </p>
      )}
      {remote && remote.length === 0 && (
        <p className="mt-2 text-sm text-(--text-muted)">{t("admin:backup.cloudList.empty")}</p>
      )}
      {remote && remote.length > 0 && (
        <ul className="mt-2 divide-y" style={{ borderColor: "var(--color-border)" }}>
          {remote.map((item) => {
            const inList = presentIds.has(item.name.replace(/\.tar\.gz$/, ""));
            const busy = downloading === item.name;
            return (
              <li key={item.name} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="text-(--text-primary)">{item.name}</span>
                {inList ? (
                  <span className="text-(--text-muted)">{t("admin:backup.cloudList.inList")}</span>
                ) : (
                  <button
                    onClick={() => void download(item.name)}
                    disabled={downloading !== null}
                    className="hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ color: "var(--accent)" }}
                  >
                    {busy
                      ? percent === null
                        ? t("admin:backup.cloudList.downloadingUnknown")
                        : t("admin:backup.cloudList.downloading", { percent })
                      : t("admin:backup.cloudList.download")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </AdminSubBlock>
  );
}
