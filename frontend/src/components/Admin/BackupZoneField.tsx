import { useMemo } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { groupTimeZones } from "../../lib/timezones";

/**
 * The zone the backup hour is read in (ADR 0002, owner decision 2 on the
 * plan): an admin setting. Empty means the server's own zone — the one every
 * instance ran its backups in before the setting existed — so an upgrade keeps
 * its backup hour. The sentence below names the zone the SERVER applies, not
 * the choice, so a zone the server refused cannot look applied.
 */
interface BackupZoneFieldProps {
  /** The chosen zone; null = the server's own zone. */
  value: string | null;
  /** The zone the scheduler runs in now, as the server reports it. */
  effective: string | null;
  /** The server's own zone, offered as the default. */
  hostZone: string | null;
  onChange: (zone: string | null) => void;
}

export default function BackupZoneField({
  value,
  effective,
  hostZone,
  onChange,
}: BackupZoneFieldProps): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const groups = useMemo(() => groupTimeZones(value), [value]);
  return (
    <div>
      <label htmlFor="backup-zone" className="block text-sm font-medium text-(--text-primary) mb-1">
        {t("admin:backup.schedule.zone")}
      </label>
      <select
        id="backup-zone"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="input w-full"
      >
        <option value="">{t("admin:backup.schedule.zoneHost", { zone: hostZone ?? "—" })}</option>
        {groups.map((group) => (
          <optgroup key={group.region} label={group.region}>
            {group.zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {effective && (
        <p className="text-xs text-(--text-muted) mt-1">
          {t("admin:backup.schedule.zoneEffective", { zone: effective })}
        </p>
      )}
    </div>
  );
}
