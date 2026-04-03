import { Link } from "react-router-dom";
import { AmberToggle, SectionCard, SectionTitle } from "./SettingsShared";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";

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
  onSave: () => void;
}

export default function AutoUpdateSection({
  autoUpdateSettings,
  loadingAutoUpdateSettings,
  onSetAutoUpdateSettings,
  onSave,
}: AutoUpdateSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);

  return (
    <SectionCard>
      <div className="flex items-center justify-between">
        <SectionTitle
          title={t("settings:autoUpdate.title")}
          description={t("settings:autoUpdate.description")}
        />
        <Link
          to="/pending-updates"
          className="text-sm font-medium"
          style={{ color: "var(--accent)" }}
        >
          {t("settings:autoUpdate.viewPending")} →
        </Link>
      </div>
      <InlineHelp
        title={t("settings:autoUpdate.info.title")}
        category="basic"
        content={
          <div className="space-y-3">
            <p>{t("settings:autoUpdate.info.description")}</p>
            <div>
              <p className="font-semibold mb-2">{t("settings:autoUpdate.info.benefits.title")}</p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                <li>{t("settings:autoUpdate.info.benefits.realTime")}</li>
                <li>{t("settings:autoUpdate.info.benefits.automatic")}</li>
                <li>{t("settings:autoUpdate.info.benefits.review")}</li>
                <li>{t("settings:autoUpdate.info.benefits.accurate")}</li>
                <li>{t("settings:autoUpdate.info.benefits.timeSaving")}</li>
              </ul>
            </div>
            <div
              className="rounded-lg p-3"
              style={{
                background: "rgba(232,160,69,0.1)",
                border: "1px solid rgba(232,160,69,0.3)",
              }}
            >
              <p className="font-semibold mb-1 text-sm" style={{ color: "var(--accent)" }}>
                {t("settings:autoUpdate.info.requirement.title")}
              </p>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {t("settings:autoUpdate.info.requirement.description")}
              </p>
            </div>
          </div>
        }
      />
      <div className="space-y-4">
        <label className="flex items-center gap-3">
          <AmberToggle
            checked={autoUpdateSettings.enabled}
            onChange={(e) =>
              onSetAutoUpdateSettings({ ...autoUpdateSettings, enabled: e.target.checked })
            }
          />
          <span style={{ color: "var(--text-primary)" }}>
            {t("settings:autoUpdate.enabled") || "Automatische Updates aktivieren"}
          </span>
        </label>
        {autoUpdateSettings.enabled && (
          <>
            <label className="flex items-center gap-3">
              <AmberToggle
                checked={autoUpdateSettings.requireApproval}
                onChange={(e) =>
                  onSetAutoUpdateSettings({
                    ...autoUpdateSettings,
                    requireApproval: e.target.checked,
                  })
                }
              />
              <span style={{ color: "var(--text-primary)" }}>
                {t("settings:autoUpdate.requireApproval") || "Bestätigung erforderlich"}
              </span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{t("settings:autoUpdate.checkInterval")}</label>
                <input
                  type="number"
                  value={autoUpdateSettings.checkInterval}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    if (value >= 5 && value <= 1440) {
                      onSetAutoUpdateSettings({ ...autoUpdateSettings, checkInterval: value });
                    }
                  }}
                  min="5"
                  max="1440"
                  className="input"
                />
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {t("settings:autoUpdate.checkIntervalDescription")}
                </p>
              </div>
              <div>
                <label className="label">{t("settings:autoUpdate.expiryHours")}</label>
                <input
                  type="number"
                  value={autoUpdateSettings.expiryHours}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    if (value >= 1 && value <= 168) {
                      onSetAutoUpdateSettings({ ...autoUpdateSettings, expiryHours: value });
                    }
                  }}
                  min="1"
                  max="168"
                  className="input"
                />
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {t("settings:autoUpdate.expiryHoursDescription")}
                </p>
              </div>
            </div>
            <label className="flex items-center gap-3">
              <AmberToggle
                checked={autoUpdateSettings.onlyDuringFlight}
                onChange={(e) =>
                  onSetAutoUpdateSettings({
                    ...autoUpdateSettings,
                    onlyDuringFlight: e.target.checked,
                  })
                }
              />
              <span style={{ color: "var(--text-primary)" }}>
                {t("settings:autoUpdate.onlyDuringFlight") || "Nur während Flugzeit"}
              </span>
            </label>
          </>
        )}
        <div
          className="flex justify-end pt-4"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <button
            onClick={onSave}
            disabled={loadingAutoUpdateSettings}
            className="btn-primary"
            style={{ boxShadow: "0 0 16px rgba(232,160,69,0.25)" }}
          >
            {loadingAutoUpdateSettings
              ? t("common:buttons.saving") || "Speichern..."
              : t("common:buttons.save") || "Speichern"}
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
