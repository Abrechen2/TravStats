import { SectionCard, SectionTitle } from "./SettingsShared";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";
import type { UnitsSettings } from "../../store/settingsStore";
import { CURRENCY_OPTIONS, getCurrencyDisplayName } from "../../lib/units";

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
      <InlineHelp
        title={t("settings:units.help.title")}
        category="basic"
        content={
          <div className="space-y-2">
            <p>{t("settings:units.help.description")}</p>
            <div>
              <p className="font-semibold">{t("settings:units.help.distanceTitle")}</p>
              <p className="ml-2 text-sm">{t("settings:units.help.distance")}</p>
            </div>
            <div>
              <p className="font-semibold">{t("settings:units.help.currencyTitle")}</p>
              <p className="ml-2 text-sm">{t("settings:units.help.currency")}</p>
            </div>
          </div>
        }
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
            onChange={(e) => onSetUnits({ currency: e.target.value })}
            className="input"
          >
            {(CURRENCY_OPTIONS.includes(units.currency)
              ? CURRENCY_OPTIONS
              : [units.currency, ...CURRENCY_OPTIONS]
            ).map((code) => (
              <option key={code} value={code}>
                {code} — {getCurrencyDisplayName(code)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </SectionCard>
  );
}
