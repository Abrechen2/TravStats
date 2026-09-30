import type { ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";
import Pill from "../ui/Pill";
import { token } from "../ui/tokens";
import { profileWallClock } from "../../lib/profileInstant";
import { SettingRow, SettingRows } from "../ui/SettingRow";

interface LastBackup {
  completedAt: string | null;
  size: string;
  status: string;
}

interface BackupSectionProps {
  lastBackup: LastBackup | null;
  backupStatus: { running: boolean } | null;
  isAdmin: boolean;
  /** Further rows of the same card — the spreadsheet export and import. */
  children?: ReactNode;
}

/**
 * ISO date and minute, as round 4 (E7) sets dates in a data line — on the
 * user's profile clock (ADR 0002 Q1): a backup belongs to no place.
 */
function isoMinute(iso: string): string {
  const local = profileWallClock(iso);
  return local ? `${local.slice(0, 10)} ${local.slice(11, 16)}` : iso;
}

export default function BackupSection({
  lastBackup,
  backupStatus,
  isAdmin,
  children,
}: BackupSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  const sizeMb = lastBackup ? (parseInt(lastBackup.size, 10) / 1024 / 1024).toFixed(2) : null;

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:backup.title")}
        description={t("settings:backup.description")}
      />
      <SettingRows>
        <SettingRow
          title={t("settings:backup.lastInstanceBackup")}
          sub={
            backupStatus?.running ? (
              t("settings:backup.status.running")
            ) : lastBackup ? (
              <span style={{ fontFamily: "var(--ts-font-mono)" }}>
                {lastBackup.completedAt ? isoMinute(lastBackup.completedAt) : "—"} ·{" "}
                {t("settings:backup.status.size", { size: sizeMb })}
              </span>
            ) : (
              t("settings:backup.status.noBackup")
            )
          }
          control={
            backupStatus?.running ? (
              <Pill color={token("accent")}>{t("settings:backup.status.runningShort")}</Pill>
            ) : lastBackup ? (
              <Pill color={token("good")}>OK</Pill>
            ) : (
              <Pill color={token("muted")} dashed>
                {t("settings:backup.status.noneShort")}
              </Pill>
            )
          }
        />
        {children}
      </SettingRows>
      <p className="t-caption">
        {isAdmin ? t("settings:backup.adminNote") : t("settings:backup.userNote")}
      </p>
    </SectionCard>
  );
}
