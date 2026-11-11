import { SectionCard } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import type { UnitsSettings } from "../../store/settingsStore";
import CurrencySelect from "../common/CurrencySelect";
import { ECB_CURRENCIES } from "../../shared/currencies";
import { SettingRows } from "../ui/SettingRow";
import { SettingItem, useSettingWrite } from "../ui/settings";
import { useSettingItem } from "../ui/settings/itemContext";
import { saveBaseCurrency } from "../../store/confirmedSettings";
import { UnitRow } from "./UnitRow";
import { useExpertRows } from "./frame/useExpertRows";
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
}

function CurrencyField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}): JSX.Element {
  const { id, locked } = useSettingItem();
  return (
    <CurrencySelect
      id={id}
      value={value}
      onChange={onChange}
      restrictTo={ECB_CURRENCIES}
      disabled={locked}
    />
  );
}

const DISTANCE_UNITS = ["kilometers", "miles", "nautical_miles"] as const;

export default function UnitsSection({ units, baseCurrency }: UnitsSectionProps): JSX.Element {
  const { t } = useTranslation(["settings", "lodging"]);
  // Same 403 as the display card, and the same silent local write before the
  // beta audit of 2026-09-19.
  const isDemo = useIsDemoAccount();
  // "Basiswährung für Summen" is an expert row (settings v3).
  const showCurrency = useExpertRows(1);
  const currency = useSettingWrite<string>("units.baseCurrency", baseCurrency, saveBaseCurrency);

  return (
    <SectionCard>
      <SettingRows>
        <UnitRow
          field="distanceUnit"
          title={t("settings:rows.distance.name")}
          sub={undefined}
          saved={units.distanceUnit}
          values={DISTANCE_UNITS}
          shortLabel={(value) => t(`settings:units.short.${value}`)}
          name={(value) => t(`settings:units.options.${value}`)}
          locked={isDemo}
        />
        <UnitRow
          field="weightUnit"
          title={t("settings:rows.weight.name")}
          sub={t("settings:rows.weight.sub")}
          help={t("settings:rows.weight.help")}
          // Persisted state from before the preference existed has none.
          saved={resolveWeightUnit(units.weightUnit)}
          values={WEIGHT_UNITS}
          // "kg" and "lb" are symbols, the same in both languages.
          shortLabel={(value) => value}
          name={(value) => t(`settings:units.weightOptions.${value}`)}
          locked={isDemo}
        />
        {showCurrency && (
          <SettingItem
            expert
            title={t("settings:rows.currency.name")}
            sub={t("settings:rows.currency.sub")}
            // Why the choice is narrower than what you may RECORD in — the one
            // question this field reliably raises.
            help={`${t("settings:rows.currency.help")} ${t("lodging:fx.baseCurrencyExplainer")}`}
            save={currency}
            locked={isDemo ? { why: "demo", reason: t("settings:blocks.lock.demo") } : undefined}
            control={<CurrencyField value={currency.value} onChange={currency.choose} />}
          />
        )}
      </SettingRows>
    </SectionCard>
  );
}
