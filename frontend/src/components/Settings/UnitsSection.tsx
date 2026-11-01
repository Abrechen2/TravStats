import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import type { UnitsSettings } from "../../store/settingsStore";
import CurrencySelect from "../common/CurrencySelect";
import HelpIcon from "../Help/HelpIcon";
import { ECB_CURRENCIES } from "../../shared/currencies";
import { SettingRow, SettingRows } from "../ui/SettingRow";
import { UnitRow } from "./UnitRow";
import DemoLockedNotice from "./DemoLockedNotice";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { WEIGHT_UNITS, resolveWeightUnit } from "../../lib/baggageAllowance";

interface UnitsSectionProps {
  units: UnitsSettings;
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

const DISTANCE_UNITS = ["kilometers", "miles", "nautical_miles"] as const;

export default function UnitsSection({
  units,
  baseCurrency,
  onSetBaseCurrency,
}: UnitsSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "lodging"]);
  // Same 403 as the display card, and the same silent local write before the
  // beta audit of 2026-09-19.
  const isDemo = useIsDemoAccount();

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:units.title")}
        description={t("settings:units.description")}
      />
      {isDemo && <DemoLockedNotice />}
      <SettingRows>
        <UnitRow
          field="distanceUnit"
          title={t("settings:units.distance")}
          sub={t("settings:units.distanceSub")}
          saved={units.distanceUnit}
          values={DISTANCE_UNITS}
          shortLabel={(value) => t(`settings:units.short.${value}`)}
          name={(value) => t(`settings:units.options.${value}`)}
          locked={isDemo}
        />
        <UnitRow
          field="weightUnit"
          title={t("settings:units.weight")}
          sub={t("settings:units.weightSub")}
          // Persisted state from before the preference existed has none.
          saved={resolveWeightUnit(units.weightUnit)}
          values={WEIGHT_UNITS}
          // "kg" and "lb" are symbols, the same in both languages.
          shortLabel={(value) => value}
          name={(value) => t(`settings:units.weightOptions.${value}`)}
          locked={isDemo}
        />
        <SettingRow
          title={t("settings:units.currency")}
          htmlFor="units-base-currency"
          sub={
            <span className="inline-flex items-center gap-1.5">
              {t("settings:units.currencySub")}
              {/* Why the choice is narrower than what you may RECORD in — the
                  one question this field reliably raises. */}
              <HelpIcon
                content={`${t("settings:units.currencyHint")} ${t("lodging:fx.baseCurrencyExplainer")}`}
                position="top"
                subject={t("settings:units.currencySub")}
              />
            </span>
          }
          control={
            <CurrencySelect
              id="units-base-currency"
              value={baseCurrency}
              onChange={onSetBaseCurrency}
              restrictTo={ECB_CURRENCIES}
              disabled={isDemo}
            />
          }
        />
      </SettingRows>
    </SectionCard>
  );
}
