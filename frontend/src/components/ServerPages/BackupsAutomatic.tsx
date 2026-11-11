import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { useBackupScheduleStore } from "../../store/backupScheduleStore";
import { backupApi } from "../../lib/api";
import type { BackupScheduleSettings } from "../../lib/api/backup";
import { groupTimeZones } from "../../lib/timezones";
import { logger } from "../../lib/logger";
import { useTranslation } from "../../hooks/useTranslation";
import { useRowCopy } from "../Settings/rowCopy";
import Button from "../ui/Button";
import { Select } from "../ui/Field";
import {
  ChoiceControl,
  ErrorLine,
  InputControl,
  SettingItem,
  SwitchControl,
  useGroupSave,
} from "../ui/settings";
import GroupFooter from "./GroupFooter";
import { useWebdavEnabled } from "./useWebdavEnabled";

type Interval = BackupScheduleSettings["backupInterval"];
interface Draft extends Record<string, unknown> {
  interval: Interval;
  retentionDays: string;
  zone: string;
  cloudRetention: boolean;
}

const draftOf = (s: BackupScheduleSettings): Draft => ({
  interval: s.backupInterval,
  retentionDays: String(s.backupRetentionDays),
  zone: s.backupZone ?? "",
  cloudRetention: s.backupCloudRetention ?? false,
});

/**
 * Backups › Erweitert (design C6, settings v3 S5): the tuning of the automatic
 * backup — interval, retention, WebDAV clean-up, zone — as one group with one save.
 * The backup itself has no switch any more (S6: always on). The form is drawn
 * only from a successful load — saving placeholder values would change the
 * rhythm and the retention (forgejo#363), so a failed load shows the failure and a
 * retry instead of a form.
 */
export default function BackupsAutomatic(): JSX.Element {
  const { t } = useTranslation(["settingsRows"]);
  const [settings, setSettings] = useState<BackupScheduleSettings | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback((): void => {
    setFailed(false);
    backupApi.getBackupSettings().then(setSettings, (error: unknown) => {
      logger.error("Failed to load backup settings", error);
      setFailed(true);
    });
  }, []);
  useEffect(load, [load]);
  if (settings) return <Form settings={settings} onSaved={setSettings} />;
  if (failed) {
    return (
      <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
        <ErrorLine>{t("settingsRows:backups.loadFailed")}</ErrorLine>
        <Button variant="secondary" onClick={load}>
          {t("settingsRows:server.retry")}
        </Button>
      </div>
    );
  }
  return <div style={{ minHeight: 80 }} aria-busy="true" />;
}

function Form({
  settings,
  onSaved,
}: {
  settings: BackupScheduleSettings;
  onSaved: (next: BackupScheduleSettings) => void;
}): JSX.Element {
  const { t } = useTranslation(["settingsRows", "settings"]);
  const row = useRowCopy("backups");
  const group = useGroupSave<Draft>({
    id: "backups-automatic",
    label: t("settingsRows:backups.groups.automatic"),
    saved: draftOf(settings),
    write: async (draft) => {
      const updated = await backupApi.updateBackupSettings({
        backupInterval: draft.interval,
        backupRetentionDays: Number(draft.retentionDays),
        backupCloudRetention: draft.cloudRetention,
        backupZone: draft.zone === "" ? null : draft.zone,
      });
      onSaved(updated);
      // The summary above reads the same schedule: tell it, or it keeps the old rhythm.
      useBackupScheduleStore.getState().publish(updated);
      return draftOf(updated);
    },
  });
  const days = Number(group.draft.retentionDays);
  const daysInvalid = !Number.isInteger(days) || days < 1 || days > 365;
  const zones = useMemo(() => groupTimeZones(group.draft.zone || null), [group.draft.zone]);
  const { enabled: webdav, failed: webdavFailed } = useWebdavEnabled();

  const every = row("baktakt");
  const keep = row("bakhalten");
  const zone = row("bakzone");
  const cloud = row("bakwddel");
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
      <SettingItem
        title={every.title}
        scope="allAccounts"
        changed={group.isChanged("interval")}
        control={
          <ChoiceControl<Interval>
            label={every.title}
            value={group.draft.interval}
            options={(["daily", "weekly", "monthly"] as const).map((v) => ({
              value: v,
              label: t(`settings:backup.intervals.${v}`),
            }))}
            onChange={(next) => group.edit({ interval: next })}
          />
        }
      />
      <SettingItem
        title={keep.title}
        sub={keep.sub}
        help={keep.help}
        scope="allAccounts"
        changed={group.isChanged("retentionDays")}
        error={
          daysInvalid ? t("settingsRows:backups.errors.range", { min: 1, max: 365 }) : undefined
        }
        control={
          <InputControl
            type="number"
            inputMode="numeric"
            value={group.draft.retentionDays}
            onChange={(next) => group.edit({ retentionDays: next })}
          />
        }
      />
      <SettingItem
        title={cloud.title}
        scope="allAccounts"
        changed={group.isChanged("cloudRetention")}
        dependency={
          webdav === false
            ? { reason: t("settingsRows:backups.deps.webdavOff") }
            : webdavFailed && webdav === null
              ? { reason: t("settingsRows:backups.deps.webdavUnknown") }
              : undefined
        }
        control={
          <SwitchControl
            checked={group.draft.cloudRetention}
            onChange={(next) => group.edit({ cloudRetention: next })}
          />
        }
      />
      <SettingItem
        title={zone.title}
        scope="allAccounts"
        changed={group.isChanged("zone")}
        control={
          <Select
            aria-label={zone.title}
            value={group.draft.zone}
            onChange={(e) => group.edit({ zone: e.target.value })}
            style={{ minWidth: 220 }}
          >
            <option value="">
              {t("settingsRows:backups.zoneHost", { zone: settings.hostZone ?? "—" })}
            </option>
            {zones.map((g) => (
              <optgroup key={g.region} label={g.region}>
                {g.zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        }
      >
        {settings.backupZoneEffective ? (
          <p className="t-caption" style={{ margin: 0 }}>
            {t("settingsRows:backups.zoneEffective", { zone: settings.backupZoneEffective })}
          </p>
        ) : null}
      </SettingItem>
      <GroupFooter group={group} disabled={daysInvalid} />
    </div>
  );
}
