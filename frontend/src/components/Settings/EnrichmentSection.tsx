import { AmberToggle, SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";

interface HistoricalEnrichmentSettings {
  enabled: boolean;
  minConfidence: number;
  maxPerDay: number;
}

interface EnrichmentSectionProps {
  historicalEnrichmentSettings: HistoricalEnrichmentSettings;
  loadingHistoricalEnrichmentSettings: boolean;
  onSetHistoricalEnrichmentSettings: (settings: HistoricalEnrichmentSettings) => void;
  onSave: () => void;
}

export default function EnrichmentSection({
  historicalEnrichmentSettings,
  loadingHistoricalEnrichmentSettings,
  onSetHistoricalEnrichmentSettings,
  onSave,
}: EnrichmentSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);

  return (
    <SectionCard>
      <div className="flex items-center gap-2">
        <SectionTitle
          title={t("settings:historicalEnrichment.title")}
          description={t("settings:historicalEnrichment.description")}
        />
        <span
          className="px-2 py-0.5 text-xs font-semibold rounded-full self-start mt-1"
          style={{ background: "rgba(240,169,71,0.15)", color: "var(--accent)" }}
        >
          Beta
        </span>
      </div>


      <div className="space-y-4">
        <label className="flex items-center gap-3">
          <AmberToggle
            checked={historicalEnrichmentSettings.enabled}
            onChange={(e) =>
              onSetHistoricalEnrichmentSettings({
                ...historicalEnrichmentSettings,
                enabled: e.target.checked,
              })
            }
          />
          <span style={{ color: "var(--text-primary)" }}>
            {t("settings:historicalEnrichment.enabled")}
          </span>
        </label>

        {historicalEnrichmentSettings.enabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t("settings:historicalEnrichment.minConfidence")}</label>
              <input
                type="number"
                value={historicalEnrichmentSettings.minConfidence}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  if (value >= 0 && value <= 100) {
                    onSetHistoricalEnrichmentSettings({
                      ...historicalEnrichmentSettings,
                      minConfidence: value,
                    });
                  }
                }}
                min="0"
                max="100"
                className="input"
              />
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {t("settings:historicalEnrichment.minConfidenceDescription")}
              </p>
            </div>
            <div>
              <label className="label">{t("settings:historicalEnrichment.maxPerDay")}</label>
              <input
                type="number"
                value={historicalEnrichmentSettings.maxPerDay}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  if (value >= 1 && value <= 1000) {
                    onSetHistoricalEnrichmentSettings({
                      ...historicalEnrichmentSettings,
                      maxPerDay: value,
                    });
                  }
                }}
                min="1"
                max="1000"
                className="input"
              />
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {t("settings:historicalEnrichment.maxPerDayDescription")}
              </p>
            </div>
          </div>
        )}

        <div
          className="flex justify-end pt-4"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <button
            onClick={onSave}
            disabled={loadingHistoricalEnrichmentSettings}
            className="btn-primary"
            style={{ boxShadow: "0 0 16px rgba(240,169,71,0.25)" }}
          >
            {loadingHistoricalEnrichmentSettings
              ? t("common:buttons.saving")
              : t("common:buttons.save")}
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
