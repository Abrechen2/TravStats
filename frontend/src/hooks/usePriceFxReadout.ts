import { useTranslation } from "./useTranslation";
import { priceFxReadout, type PriceFxSnapshot } from "../lib/priceFxReadout";
import { useSettingsStore } from "../store/settingsStore";

/**
 * Reads an entry's stored FX snapshot as one line, in the viewer's language
 * and against the account's base currency — the same words a lodging stay uses.
 */
export function usePriceFxReadout(): (entry: PriceFxSnapshot) => string | null {
  const { t, i18n } = useTranslation(["common"]);
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);
  return (entry) =>
    priceFxReadout(
      entry,
      i18n.language,
      {
        ecb: t("common:fx.ecb"),
        market: t("common:fx.market"),
        manual: t("common:fx.manual"),
        none: t("common:fx.none"),
      },
      baseCurrency
    );
}
