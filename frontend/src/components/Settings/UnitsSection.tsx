import { SectionCard, SectionTitle } from "./SettingsShared";
import InlineHelp from "../Help/InlineHelp";
import { useTranslation } from "../../hooks/useTranslation";
import type { UnitsSettings } from "../../store/settingsStore";
import CurrencySelect from "../common/CurrencySelect";
import { ECB_CURRENCIES } from "../../shared/currencies";

interface UnitsSectionProps {
  units: UnitsSettings;
  onSetUnits: (partial: Partial<UnitsSettings>) => void;
  /**
   * The one currency the app has. It is `UserSettings.baseCurrency` — a real
   * column, the currency every lodging FX snapshot is taken in and the one
   * stats and achievements already report in.
   *
   * There used to be a second one, `units.currency`, living in the settings
   * JSON and read only by flight surfaces. So the app had a currency under
   * "Einheiten & Formate" that governed flights alone, and a currency under
   * "Unterkunfts-Präferenzen" that governed everything else — the general one
   * was domain-specific and the domain-specific one was general, exactly
   * swapped. Three separate comments in the codebase warned readers not to mix
   * them up, which is a symptom rather than a fix.
   */
  baseCurrency: string;
  onSetBaseCurrency: (currency: string) => void;
}

export default function UnitsSection({
  units,
  onSetUnits,
  baseCurrency,
  onSetBaseCurrency,
}: UnitsSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "lodging"]);

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
          <label className="label" htmlFor="units-base-currency">
            {t("settings:units.currency")}
          </label>
          <CurrencySelect
            id="units-base-currency"
            value={baseCurrency}
            onChange={onSetBaseCurrency}
            restrictTo={ECB_CURRENCIES}
          />
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("settings:units.currencyHint")}
          </p>
          {/* Why the choice is narrower than what you may RECORD in — the one
              question this field reliably raises. */}
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("lodging:fx.baseCurrencyExplainer")}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
