import { AmberToggle, SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import type { PrivacySettings } from "../../store/settingsStore";

interface PrivacySectionProps {
  privacy: PrivacySettings;
  onSetPrivacy: (partial: Partial<PrivacySettings>) => void;
}

export default function PrivacySection({
  privacy,
  onSetPrivacy,
}: PrivacySectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:privacy.title")}
        description={t("settings:privacy.description")}
      />
      <div className="space-y-3">
        <label className="flex items-center gap-3">
          <AmberToggle
            checked={privacy.twoFactorAuth}
            onChange={(e) => onSetPrivacy({ twoFactorAuth: e.target.checked })}
          />
          <span style={{ color: "var(--text-primary)" }}>
            {t("settings:privacy.twoFactorAuth")}
          </span>
        </label>
        <label className="flex items-center gap-3">
          <AmberToggle
            checked={privacy.loginAlerts}
            onChange={(e) => onSetPrivacy({ loginAlerts: e.target.checked })}
          />
          <span style={{ color: "var(--text-primary)" }}>{t("settings:privacy.loginAlerts")}</span>
        </label>
        <label className="flex items-center gap-3">
          <AmberToggle
            checked={privacy.analyticsOptIn ?? false}
            onChange={(e) => onSetPrivacy({ analyticsOptIn: e.target.checked })}
          />
          <span style={{ color: "var(--text-primary)" }}>
            {t("settings:privacy.analyticsOptIn")}
          </span>
        </label>
        <div className="flex items-center gap-3">
          <button
            className="btn-secondary"
            onClick={() => onSetPrivacy({ dataExportRequested: true })}
          >
            {t("settings:privacy.dataExport")}
          </button>
          {privacy.dataExportRequested && (
            <span className="text-sm" style={{ color: "var(--success)" }}>
              {t("settings:privacy.dataExportRequested")}
            </span>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
