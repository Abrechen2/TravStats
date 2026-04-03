import { AmberToggle, SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import type { BackupSettings } from "../../store/settingsStore";

interface LastBackup {
  completedAt: string | null;
  size: string;
  status: string;
}

interface BackupSectionProps {
  backup: BackupSettings;
  retentionDays: number;
  lastBackup: LastBackup | null;
  backupStatus: { running: boolean } | null;
  isAdmin: boolean;
  onSetBackup: (partial: Partial<BackupSettings>) => void;
  onSetRetentionDays: (days: number) => void;
}

export default function BackupSection({
  backup,
  retentionDays,
  lastBackup,
  backupStatus,
  isAdmin,
  onSetBackup,
  onSetRetentionDays,
}: BackupSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:backup.title")}
        description={t("settings:backup.description")}
      />
      <div className="space-y-3">
        <label className="flex items-center gap-3">
          <AmberToggle
            checked={backup.autoBackup}
            onChange={(e) => onSetBackup({ autoBackup: e.target.checked })}
          />
          <span style={{ color: "var(--text-primary)" }}>{t("settings:backup.autoBackup")}</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">{t("settings:backup.backupInterval")}</label>
            <select
              value={backup.backupInterval}
              onChange={(e) =>
                onSetBackup({ backupInterval: e.target.value as typeof backup.backupInterval })
              }
              className="input"
            >
              <option value="daily">{t("settings:backup.intervals.daily")}</option>
              <option value="weekly">{t("settings:backup.intervals.weekly")}</option>
              <option value="monthly">{t("settings:backup.intervals.monthly")}</option>
            </select>
          </div>
          <div>
            <label className="label">{t("settings:backup.exportFormat")}</label>
            <select
              value={backup.exportFormat}
              onChange={(e) =>
                onSetBackup({ exportFormat: e.target.value as typeof backup.exportFormat })
              }
              className="input"
            >
              <option value="json">{t("settings:backup.formats.json")}</option>
              <option value="csv">{t("settings:backup.formats.csv")}</option>
              <option value="pdf">{t("settings:backup.formats.pdf")}</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-3">
          <AmberToggle
            checked={backup.cloudSync}
            onChange={(e) => onSetBackup({ cloudSync: e.target.checked })}
          />
          <span style={{ color: "var(--text-primary)" }}>{t("settings:backup.cloudSync")}</span>
        </label>
        <div>
          <label className="label">{t("settings:backup.retentionDays")}</label>
          <input
            type="number"
            value={retentionDays}
            onChange={(e) => onSetRetentionDays(parseInt(e.target.value, 10) || 30)}
            min="1"
            max="365"
            className="input"
          />
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {t("settings:backup.retentionDaysDescription", { days: retentionDays })}
          </p>
        </div>
        {isAdmin && (
          <>
            <div className="pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
              <p className="text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                {t("settings:backup.status.title")}
              </p>
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
            <div className="pt-2">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("settings:backup.status.path", { path: "/app/data/backups" })}
              </p>
            </div>
          </>
        )}
      </div>
    </SectionCard>
  );
}
