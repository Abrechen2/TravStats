import { Link } from "react-router-dom";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { Switch } from "../ui/Field";
import { SettingRow, SettingRows } from "../ui/SettingRow";
import { useExpertRows } from "./frame/useExpertRows";

interface AutoUpdateSettings {
  enabled: boolean;
  requireApproval: boolean;
  checkInterval: number;
  onlyDuringFlight: boolean;
  expiryHours: number;
}

interface AutoUpdateSectionProps {
  autoUpdateSettings: AutoUpdateSettings;
  loadingAutoUpdateSettings: boolean;
  onSetAutoUpdateSettings: (settings: AutoUpdateSettings) => void;
  /** Writes the given value. Switches call it at once, number fields on leaving. */
  onSave: (settings: AutoUpdateSettings) => void;
}

export default function AutoUpdateSection({
  autoUpdateSettings: settings,
  loadingAutoUpdateSettings,
  onSetAutoUpdateSettings,
  onSave,
}: AutoUpdateSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);
  // The switch is the standard setting (live updates on or off); how they run
  // — approval, flight window, polling interval, expiry — is tuning, shown at
  // the expert level (forgejo#321). The four rows exist only while it is on.
  const expert = useExpertRows(settings.enabled ? 4 : 0);
  const tuning = settings.enabled && expert;

  const numberField = (
    id: string,
    key: "checkInterval" | "expiryHours",
    min: number,
    max: number
  ): JSX.Element => (
    <input
      id={id}
      type="number"
      value={settings[key]}
      onChange={(e) => {
        const value = parseInt(e.target.value, 10);
        if (value >= min && value <= max) {
          onSetAutoUpdateSettings({ ...settings, [key]: value });
        }
      }}
      onBlur={() => onSave(settings)}
      min={min}
      max={max}
      className="input"
      style={{ width: 120 }}
    />
  );

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:autoUpdate.title")}
        description={t("settings:autoUpdate.description")}
        aside={
          <Link to="/pending-updates" className="font-medium" style={{ color: "var(--accent)" }}>
            {t("settings:autoUpdate.viewPending")} →
          </Link>
        }
      />
      <SettingRows>
        <Switch
          id="autoupdate-enabled"
          checked={settings.enabled}
          disabled={loadingAutoUpdateSettings}
          onChange={(on) => onSave({ ...settings, enabled: on })}
          label={t("settings:autoUpdate.enabled")}
        />
        {tuning && (
          <Switch
            id="autoupdate-require-approval"
            checked={settings.requireApproval}
            onChange={(on) => onSave({ ...settings, requireApproval: on })}
            label={t("settings:autoUpdate.requireApproval")}
          />
        )}
        {tuning && (
          <Switch
            id="autoupdate-only-during-flight"
            checked={settings.onlyDuringFlight}
            onChange={(on) => onSave({ ...settings, onlyDuringFlight: on })}
            label={t("settings:autoUpdate.onlyDuringFlight")}
          />
        )}
        {tuning && (
          <SettingRow
            title={t("settings:autoUpdate.checkInterval")}
            sub={t("settings:autoUpdate.checkIntervalDescription")}
            htmlFor="autoupdate-check-interval"
            control={numberField("autoupdate-check-interval", "checkInterval", 5, 1440)}
          />
        )}
        {tuning && (
          <SettingRow
            title={t("settings:autoUpdate.expiryHours")}
            sub={t("settings:autoUpdate.expiryHoursDescription")}
            htmlFor="autoupdate-expiry-hours"
            control={numberField("autoupdate-expiry-hours", "expiryHours", 1, 168)}
          />
        )}
      </SettingRows>
    </SectionCard>
  );
}
