import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";
import type { UnitsSettings } from "../../store/settingsStore";
import CurrencySelect from "../common/CurrencySelect";
import HelpIcon from "../Help/HelpIcon";
import { ECB_CURRENCIES } from "../../shared/currencies";
import { Segmented } from "../ui/Segmented";
import { SettingRow, SettingRows } from "../ui/SettingRow";
import DemoLockedNotice from "./DemoLockedNotice";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";

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

const DISTANCE_UNITS = ["kilometers", "miles", "nautical_miles"] as const;

export default function UnitsSection({
  units,
  onSetUnits,
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
        <SettingRow
          title={t("settings:units.distance")}
          sub={t("settings:units.distanceSub")}
          control={
            <Segmented
              label={t("settings:units.distance")}
              value={units.distanceUnit}
              options={DISTANCE_UNITS.map((value) => ({
                value,
                label: t(`settings:units.short.${value}`),
                name: t(`settings:units.options.${value}`),
              }))}
              onChange={(distanceUnit) => onSetUnits({ distanceUnit })}
              disabled={isDemo}
            />
          }
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
