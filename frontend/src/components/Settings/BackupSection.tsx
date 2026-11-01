import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { backupApi, type InstanceBackupStatus } from "../../lib/api/backup";
import { logger } from "../../lib/logger";
import { profileWallClock } from "../../lib/profileInstant";
import { SettingRows } from "../ui/SettingRow";
import { SettingItem, StatusValue } from "../ui/settings";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { DataJumpList, DATA_PART_ANCHOR } from "./DataJumpList";
import MeExportRow from "./MeExportRow";
import SpreadsheetSection from "./SpreadsheetSection";
import TrackArchiveSection from "./TrackArchiveSection";
import WebdavSyncRow from "./WebdavSyncRow";
import { useRowCopy } from "./rowCopy";

/** Re-read while a backup runs, so "läuft gerade" does not outlive the run. */
const POLL_MS = 30_000;

/**
 * ISO date and minute, as round 4 (E7) sets dates in a data line — on the
 * user's profile clock (ADR 0002 Q1): a backup belongs to no place.
 */
function isoMinute(iso: string): string {
  const local = profileWallClock(iso);
  return local ? `${local.slice(0, 10)} ${local.slice(11, 16)}` : iso;
}

/**
 * "Letzte Sicherung des Servers" (design R3): every account sees WHEN the
 * server last backed itself up — a status row, nothing to set: the admin takes
 * care of it. It reads the minimal `GET /settings/instance-backup`, because the
 * backup list itself is admin-only; a failed read says so and offers a retry
 * rather than reading as "no backup yet".
 */
function InstanceBackupRow(): JSX.Element {
  const { t } = useTranslation(["settings", "settingsRows"]);
  const copy = useRowCopy("data")("srvbackup");
  const [status, setStatus] = useState<InstanceBackupStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setStatus(await backupApi.getInstanceStatus());
      setFailed(false);
    } catch (error) {
      logger.error("Failed to load the instance backup status:", error);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  const running = status?.running === true;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  return (
    <SettingItem
      title={copy.title}
      sub={copy.sub}
      error={failed ? t("settings:backup.instance.loadFailed") : undefined}
      control={
        failed ? (
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            {t("settings:backup.instance.retry")}
          </button>
        ) : status ? (
          <StatusValue>
            {running
              ? t("settings:backup.instance.running")
              : status.completedAt
                ? isoMinute(status.completedAt)
                : t("settings:backup.instance.none")}
          </StatusValue>
        ) : null
      }
    />
  );
}

/**
 * The page's two data sections that leave the server: "Sicherung" (the
 * server's last backup for everyone, the account's own copy on WebDAV) and
 * "Mitnehmen" (what the account downloads: all its data as JSON, the Excel
 * sheet, the recordings). A backup restores an instance; the spreadsheet is
 * for reading and editing — they are not the same thing, and the rows say so.
 */
export default function BackupSection(): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-xl)" }}>
      <DataJumpList />
      <div id={DATA_PART_ANCHOR.backup} tabIndex={-1} style={{ outline: "none" }}>
        <SectionCard>
          <SectionTitle title={t("settingsRows:data.sections.backup")} />
          <SettingRows>
            <InstanceBackupRow />
            <WebdavSyncRow />
          </SettingRows>
        </SectionCard>
      </div>
      <div id={DATA_PART_ANCHOR.export} tabIndex={-1} style={{ outline: "none" }}>
        <SectionCard>
          <SectionTitle title={t("settingsRows:data.sections.export")} />
          <SettingRows>
            <MeExportRow />
            <SpreadsheetSection part="export" />
            <TrackArchiveSection part="export" />
          </SettingRows>
        </SectionCard>
      </div>
    </div>
  );
}
