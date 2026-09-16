import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import Pill from "../ui/Pill";
import { token } from "../ui/tokens";
import { Switch } from "../ui/Field";
import { SettingRow, SettingRows } from "../ui/SettingRow";

interface HistoricalEnrichmentSettings {
  enabled: boolean;
  minConfidence: number;
  maxPerDay: number;
}

interface EnrichmentSectionProps {
  historicalEnrichmentSettings: HistoricalEnrichmentSettings;
  loadingHistoricalEnrichmentSettings: boolean;
  onSetHistoricalEnrichmentSettings: (settings: HistoricalEnrichmentSettings) => void;
  /** Writes the given value. Switches call it at once, number fields on leaving. */
  onSave: (settings: HistoricalEnrichmentSettings) => void;
}

export default function EnrichmentSection({
  historicalEnrichmentSettings: settings,
  loadingHistoricalEnrichmentSettings,
  onSetHistoricalEnrichmentSettings,
  onSave,
}: EnrichmentSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "common"]);

  const numberField = (
    id: string,
    key: "minConfidence" | "maxPerDay",
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
          onSetHistoricalEnrichmentSettings({ ...settings, [key]: value });
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
        title={t("settings:historicalEnrichment.title")}
        description={t("settings:historicalEnrichment.description")}
        badge={<Pill color={token("accent")}>Beta</Pill>}
      />
      <SettingRows>
        <Switch
          id="enrichment-enabled"
          checked={settings.enabled}
          disabled={loadingHistoricalEnrichmentSettings}
          onChange={(on) => onSave({ ...settings, enabled: on })}
          label={t("settings:historicalEnrichment.enabled")}
        />
        {settings.enabled && (
          <SettingRow
            title={t("settings:historicalEnrichment.minConfidence")}
            sub={t("settings:historicalEnrichment.minConfidenceDescription")}
            htmlFor="enrichment-min-confidence"
            control={numberField("enrichment-min-confidence", "minConfidence", 0, 100)}
          />
        )}
        {settings.enabled && (
          <SettingRow
            title={t("settings:historicalEnrichment.maxPerDay")}
            sub={t("settings:historicalEnrichment.maxPerDayDescription")}
            htmlFor="enrichment-max-per-day"
            control={numberField("enrichment-max-per-day", "maxPerDay", 1, 1000)}
          />
        )}
      </SettingRows>
    </SectionCard>
  );
}
