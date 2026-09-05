import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import { changeLanguage } from "../../i18n/config";
import type { DisplaySettings } from "../../store/settingsStore";

const timezoneOptions = [
  "Europe/Berlin",
  "Europe/Paris",
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Singapore",
];

interface DisplaySectionProps {
  display: DisplaySettings;
  onSetDisplay: (partial: Partial<DisplaySettings>) => void;
}

export default function DisplaySection({
  display,
  onSetDisplay,
}: DisplaySectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:display.title")}
        description={t("settings:display.description")}
      />

      {/* Form fields are constrained to a readable max-width so dropdowns
          like "Time format" / "Language" don't stretch across the full
          card on wide screens — they always have a fixed handful of
          options, so a 320 px field reads cleaner than a 900 px one. */}
      <div className="space-y-4 max-w-md">
        <div>
          <label className="label">{t("settings:display.language")}</label>
          <select
            value={display.language}
            onChange={(e) => {
              const newLang = e.target.value as "de" | "en";
              void changeLanguage(newLang);
            }}
            className="input"
          >
            <option value="de">{t("settings:display.languages.de")}</option>
            <option value="en">{t("settings:display.languages.en")}</option>
          </select>
        </div>

        <div>
          <label className="label">{t("settings:display.timezone")}</label>
          <select
            value={display.timezone}
            onChange={(e) => onSetDisplay({ timezone: e.target.value })}
            className="input"
          >
            {timezoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">{t("settings:display.dateFormat")}</label>
            <select
              value={display.dateFormat}
              onChange={(e) =>
                onSetDisplay({ dateFormat: e.target.value as typeof display.dateFormat })
              }
              className="input"
            >
              <option value="DD.MM.YYYY">DD.MM.YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </div>
          <div>
            <label className="label">{t("settings:display.timeFormat")}</label>
            <select
              value={display.timeFormat}
              onChange={(e) =>
                onSetDisplay({ timeFormat: e.target.value as typeof display.timeFormat })
              }
              className="input"
            >
              <option value="24h">24h</option>
              <option value="12h">12h AM/PM</option>
            </select>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
