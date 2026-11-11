import { useEffect, useState, type JSX } from "react";
import { backupApi } from "../../lib/api";
import type { BackupScheduleSettings } from "../../lib/api/backup";
import { logger } from "../../lib/logger";
import { profileDateTime } from "../../lib/profileInstant";
import { useTranslation } from "../../hooks/useTranslation";
import { useRowCopy } from "../Settings/rowCopy";
import { SettingItem, StatusValue } from "../ui/settings";
import type { Backup } from "../Admin/backupTypes";

const formatSize = (bytes: string): string => {
  const size = parseInt(bytes, 10);
  if (!Number.isFinite(size)) return "";
  if (size < 1024 ** 2) return `${Math.max(1, Math.round(size / 1024))} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
};

/**
 * The top of Sicherungen (settings v3 S5): one line for the schedule — what the
 * automatic backup does — and the three facts the page is read for: the last
 * backup that completed, when the next one is due, and how many are kept. All of
 * it is read from the schedule and the list the page already holds; nothing is
 * computed that the server did not say. The schedule is a rhythm ("weekly,
 * 02:00"), not a date: the server does not report the next run.
 */
export default function BackupsSummary({ backups }: { backups: Backup[] | null }): JSX.Element {
  const { t } = useTranslation(["settingsRows", "settings"]);
  const row = useRowCopy("backups");
  const [schedule, setSchedule] = useState<BackupScheduleSettings | null>(null);
  useEffect(() => {
    let alive = true;
    backupApi.getBackupSettings().then(
      (s) => alive && setSchedule(s),
      (error: unknown) => logger.error("Failed to load the backup schedule", error)
    );
    return () => {
      alive = false;
    };
  }, []);

  const done = (backups ?? [])
    .filter((b) => b.status === "completed" && b.completedAt)
    .sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!));
  const last = done[0];
  const zone = schedule?.backupZoneEffective ?? schedule?.backupZone ?? schedule?.hostZone ?? "";
  const rhythm = schedule
    ? schedule.backupEnabled
      ? t("settingsRows:backups.rhythm", {
          interval: t(`settings:backup.intervals.${schedule.backupInterval}`),
          zone,
        })
      : t("settingsRows:backups.rhythmOff")
    : null;
  const auto = row("baknow");
  return (
    <>
      {schedule ? (
        <SettingItem
          title={auto.title}
          scope="allAccounts"
          control={
            <StatusValue>
              {schedule.backupEnabled
                ? t("settingsRows:backups.nowLine", {
                    interval: t(`settings:backup.intervals.${schedule.backupInterval}`),
                    days: schedule.backupRetentionDays,
                  })
                : t("settingsRows:backups.rhythmOff")}
            </StatusValue>
          }
        />
      ) : null}
      {backups ? (
        <div className="flex flex-col" data-backup-stats="" style={{ gap: "var(--ts-space-xs)" }}>
          <SettingItem
            title={t("settingsRows:backups.stats.last")}
            scope="allAccounts"
            control={
              <StatusValue>
                {last
                  ? `${profileDateTime(new Date(last.completedAt!)) ?? "—"} · ${formatSize(last.size)}`
                  : t("settingsRows:backups.empty")}
              </StatusValue>
            }
          />
          {rhythm ? (
            <SettingItem
              title={t("settingsRows:backups.stats.next")}
              scope="allAccounts"
              control={<StatusValue>{rhythm}</StatusValue>}
            />
          ) : null}
          <SettingItem
            title={t("settingsRows:backups.stats.kept")}
            scope="allAccounts"
            control={
              <StatusValue>
                {t("settingsRows:backups.stats.keptCount", { count: done.length })}
              </StatusValue>
            }
          />
        </div>
      ) : null}
    </>
  );
}
