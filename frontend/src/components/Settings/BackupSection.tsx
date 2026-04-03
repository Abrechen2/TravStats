import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";

interface LastBackup {
  completedAt: string | null;
  size: string;
  status: string;
}

interface BackupSectionProps {
  lastBackup: LastBackup | null;
  backupStatus: { running: boolean } | null;
  isAdmin: boolean;
}

export default function BackupSection({
  lastBackup,
  backupStatus,
  isAdmin,
}: BackupSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:backup.title")}
        description={t("settings:backup.description")}
      />
      <div className="space-y-3">
        {isAdmin ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("settings:backup.adminNote")}
          </p>
        ) : (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("settings:backup.userNote")}
          </p>
        )}
        {backupStatus?.running ? (
          <div className="flex items-center gap-2" style={{ color: "var(--accent)" }}>
            <span className="animate-pulse">&#9679;</span>
            <span>{t("settings:backup.status.running")}</span>
          </div>
        ) : lastBackup ? (
          <div className="space-y-1">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("settings:backup.status.lastBackup", {
                date: lastBackup.completedAt
                  ? new Date(lastBackup.completedAt).toLocaleString("de-DE")
                  : "-",
              })}
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {t("settings:backup.status.size", {
                size: (parseInt(lastBackup.size, 10) / 1024 / 1024).toFixed(2),
              })}
            </p>
          </div>
        ) : (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("settings:backup.status.noBackup")}
          </p>
        )}
      </div>
    </SectionCard>
  );
}
