import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import type { UnitsSettings } from "../../store/settingsStore";

interface UnitsSectionProps {
  units: UnitsSettings;
  onSetUnits: (partial: Partial<UnitsSettings>) => void;
}

export default function UnitsSection({ units, onSetUnits }: UnitsSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:units.title")}
        description={t("settings:units.description")}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">{t("settings:units.distance")}</label>
          <select
            value={units.distanceUnit}
            onChange={(e) =>
              onSetUnits({ distanceUnit: e.target.value as typeof units.distanceUnit })
            }
            className="input"
          >
            <option value="kilometers">{t("settings:units.options.kilometers")}</option>
            <option value="miles">{t("settings:units.options.miles")}</option>
            <option value="nautical_miles">{t("settings:units.options.nautical_miles")}</option>
          </select>
        </div>
        <div>
          <label className="label">{t("settings:units.currency")}</label>
          <select
            value={units.currency}
            onChange={(e) => onSetUnits({ currency: e.target.value as typeof units.currency })}
            className="input"
          >
            <option value="EUR">{t("settings:units.options.EUR")}</option>
            <option value="USD">{t("settings:units.options.USD")}</option>
            <option value="GBP">{t("settings:units.options.GBP")}</option>
            <option value="CHF">{t("settings:units.options.CHF")}</option>
          </select>
        </div>
      </div>
    </SectionCard>
  );
}
