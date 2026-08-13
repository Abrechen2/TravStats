import CurrencySelect from "../common/CurrencySelect";
import { ECB_CURRENCIES } from "../../shared/currencies";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { useTranslation } from "../../hooks/useTranslation";

interface LodgingPreferencesSectionProps {
  /** The user's actual base currency (`UserSettings.baseCurrency`) — every
   * stay is converted into this currency at the ECB rate for its check-in
   * day. Deliberately NOT `units.currency`, which is an unrelated display
   * preference used elsewhere for flight-cost figures. */
  baseCurrency: string;
  onSetBaseCurrency: (currency: string) => void;
}


/**
 * Lodging-domain preferences section, mirroring `CruisePreferencesSection`'s
 * card/section pattern. Currently a single field: the base currency that
 * `GET /stats/lodging` and every lodging's `totalSpendBase` are computed
 * in. Changing it only affects future FX conversions — existing stays keep
 * the immutable FX snapshot taken on their own check-in day and are never
 * recalculated (see `lodgingPreferences.baseCurrencyHint`).
 */
export default function LodgingPreferencesSection({
  baseCurrency,
  onSetBaseCurrency,
}: LodgingPreferencesSectionProps): JSX.Element {
  const { t } = useTranslation(["settings"]);

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:lodgingPreferences.title")}
        description={t("settings:lodgingPreferences.description")}
      />

      <div>
        <label className="label" htmlFor="lodging-base-currency">
          {t("settings:lodgingPreferences.baseCurrency")}
        </label>
        <CurrencySelect
          id="lodging-base-currency"
          value={baseCurrency}
          onChange={onSetBaseCurrency}
          restrictTo={ECB_CURRENCIES}
        />
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("settings:lodgingPreferences.baseCurrencyHint")}
        </p>
      </div>
    </SectionCard>
  );
}
