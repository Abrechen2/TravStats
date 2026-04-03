import { SectionCard, SectionTitle } from "./SettingsShared";
import InlineHelp from "../Help/InlineHelp";
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
  isDarkMode: boolean;
  onSetDisplay: (partial: Partial<DisplaySettings>) => void;
  onThemeToggle: () => void;
}

export default function DisplaySection({
  display,
  isDarkMode,
  onSetDisplay,
  onThemeToggle,
}: DisplaySectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <div className="flex items-center justify-between">
        <SectionTitle
          title={t("settings:display.title")}
          description={t("settings:display.description")}
        />
        <button
          onClick={onThemeToggle}
          className="px-3 py-2 rounded-lg border text-sm"
          style={{
            background: "var(--bg-elevated)",
            color: isDarkMode ? "var(--accent)" : "var(--text-primary)",
            borderColor: "var(--color-border)",
          }}
        >
          {isDarkMode
            ? t("settings:display.theme.darkMode") + " " + t("settings:display.theme.active")
            : t("settings:display.theme.lightMode") + " " + t("settings:display.theme.active")}
        </button>
      </div>

      <InlineHelp
        title={t("settings:display.theme.title")}
        category="basic"
        content={
          <div className="space-y-2">
            <p>{t("settings:display.theme.description")}</p>
            <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
              <li>
                <strong>{t("settings:display.theme.lightMode")}:</strong>{" "}
                {t("settings:display.theme.lightDescription")}
              </li>
              <li>
                <strong>{t("settings:display.theme.darkMode")}:</strong>{" "}
                {t("settings:display.theme.darkDescription")}
              </li>
              <li>{t("settings:display.theme.autoSave")}</li>
            </ul>
          </div>
        }
      />

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
    </SectionCard>
  );
}
