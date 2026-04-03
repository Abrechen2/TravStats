import { AmberToggle, SectionCard, SectionTitle } from "./SettingsShared";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";

interface HistoricalEnrichmentSettings {
  enabled: boolean;
  minConfidence: number;
  maxAgeYears: number;
  autoProcess: boolean;
  maxPerDay: number;
  requireApproval: boolean;
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
          title={t("settings:historicalEnrichment.title") || "Historische Anreicherung (Beta)"}
          description={
            t("settings:historicalEnrichment.description") ||
            "Ergänzt historische Flüge (2-5 Jahre) mit Daten von Live-getrackten Flügen derselben Flugnummer"
          }
        />
        <span
          className="px-2 py-0.5 text-xs font-semibold rounded-full self-start mt-1"
          style={{ background: "rgba(232,160,69,0.15)", color: "var(--accent)" }}
        >
          Beta
        </span>
      </div>
      <InlineHelp
        title={t("settings:historicalEnrichment.info.title")}
        category="basic"
        content={
          <div className="space-y-3">
            <p>{t("settings:historicalEnrichment.info.description")}</p>
            <div>
              <p className="font-semibold mb-2">
                {t("settings:historicalEnrichment.info.benefits.title")}
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2 text-sm">
                <li>{t("settings:historicalEnrichment.info.benefits.completeData")}</li>
                <li>{t("settings:historicalEnrichment.info.benefits.routeTracking")}</li>
                <li>{t("settings:historicalEnrichment.info.benefits.statistics")}</li>
                <li>{t("settings:historicalEnrichment.info.benefits.automatic")}</li>
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
                {t("settings:historicalEnrichment.info.warning.title")}
              </p>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {t("settings:historicalEnrichment.info.warning.description")}
              </p>
            </div>
          </div>
        }
      />
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
            {t("settings:historicalEnrichment.enabled") ||
              "Historische Flugdaten-Anreicherung aktivieren"}
          </span>
        </label>
        {historicalEnrichmentSettings.enabled && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">
                  {t("settings:historicalEnrichment.minConfidence") || "Min Confidence (%)"}
                </label>
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
                  {t("settings:historicalEnrichment.minConfidenceDescription") ||
                    "Nur Anreicherungen mit mindestens X% Confidence anzeigen"}
                </p>
              </div>
              <div>
                <label className="label">
                  {t("settings:historicalEnrichment.maxPerDay") || "Max pro Tag"}
                </label>
                <input
                  type="number"
                  value={historicalEnrichmentSettings.maxPerDay}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    if (value >= 10 && value <= 200) {
                      onSetHistoricalEnrichmentSettings({
                        ...historicalEnrichmentSettings,
                        maxPerDay: value,
                      });
                    }
                  }}
                  min="10"
                  max="200"
                  className="input"
                />
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {t("settings:historicalEnrichment.maxPerDayDescription") ||
                    "Maximale Anzahl Anreicherungen pro Tag"}
                </p>
              </div>
              <div>
                <label className="label">
                  {t("settings:historicalEnrichment.maxAgeYears") || "Max Alter (Jahre)"}
                </label>
                <input
                  type="number"
                  value={historicalEnrichmentSettings.maxAgeYears}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    if (value >= 2 && value <= 10) {
                      onSetHistoricalEnrichmentSettings({
                        ...historicalEnrichmentSettings,
                        maxAgeYears: value,
                      });
                    }
                  }}
                  min="2"
                  max="10"
                  className="input"
                />
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {t("settings:historicalEnrichment.maxAgeYearsDescription") ||
                    "Maximales Alter von Flügen für Anreicherung"}
                </p>
              </div>
            </div>
            <label className="flex items-center gap-3">
              <AmberToggle
                checked={historicalEnrichmentSettings.autoProcess}
                onChange={(e) =>
                  onSetHistoricalEnrichmentSettings({
                    ...historicalEnrichmentSettings,
                    autoProcess: e.target.checked,
                  })
                }
              />
              <span style={{ color: "var(--text-primary)" }}>
                {t("settings:historicalEnrichment.autoProcess") ||
                  "Automatisch nachts nach Anreicherungs-Kandidaten suchen"}
              </span>
            </label>
            <label className="flex items-center gap-3">
              <AmberToggle
                checked={historicalEnrichmentSettings.requireApproval}
                onChange={(e) =>
                  onSetHistoricalEnrichmentSettings({
                    ...historicalEnrichmentSettings,
                    requireApproval: e.target.checked,
                  })
                }
              />
              <span style={{ color: "var(--text-primary)" }}>
                {t("settings:historicalEnrichment.requireApproval") ||
                  "Jede Anreicherung muss manuell bestätigt werden"}
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
            disabled={loadingHistoricalEnrichmentSettings}
            className="btn-primary"
            style={{ boxShadow: "0 0 16px rgba(232,160,69,0.25)" }}
          >
            {loadingHistoricalEnrichmentSettings
              ? t("common:buttons.saving") || "Speichern..."
              : t("common:buttons.save") || "Speichern"}
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
