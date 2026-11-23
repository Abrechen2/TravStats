import { useEffect, useState, type JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { adminApi } from "../../lib/api/admin";
import { ChoiceControl, ErrorLine, SettingItem } from "../ui/settings";
import { routingEffectiveText } from "./RoutingLines";
import { useServices } from "./servicesContext";

/** `null` in the database is "Automatisch"; "off" is "Aus", chosen on purpose. */
type Choice = "auto" | "openrouteservice" | "graphhopper" | "custom" | "off";

const toChoice = (stored: string | null): Choice => (stored === null ? "auto" : (stored as Choice));

/**
 * The instance's routing provider (admin). Unset is "Automatisch (empfohlen)":
 * each account is served by the first allowed and configured of ORS → GraphHopper
 * → own server. The admin's own effective result stands right under the choice.
 */
export default function RoutingProviderRow(): JSX.Element | null {
  const { t } = useTranslation(["settingsRows"]);
  const { account } = useServices();
  const [value, setValue] = useState<Choice | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    adminApi
      .getGlobalApiKeys()
      .then((k) => {
        if (live) setValue(toChoice(k.routingProvider));
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const choose = async (next: Choice): Promise<void> => {
    const before = value;
    setValue(next);
    setError(false);
    try {
      await adminApi.updateGlobalApiKeys({ routingProvider: next === "auto" ? null : next });
      await account.reload();
    } catch {
      setValue(before);
      setError(true);
    }
  };

  const routing = account.data?.routing;
  return (
    <SettingItem
      title={t("settingsRows:services.routing.pickT")}
      sub={t("settingsRows:services.routing.pickS")}
      scope="allAccounts"
      control={
        value === null ? null : (
          <ChoiceControl
            label={t("settingsRows:services.routing.pickT")}
            value={value}
            onChange={(v) => void choose(v)}
            options={[
              { value: "auto", label: t("settingsRows:services.routing.optAuto") },
              { value: "openrouteservice", label: "OpenRouteService" },
              { value: "graphhopper", label: "GraphHopper" },
              { value: "custom", label: t("settingsRows:services.routing.optCustom") },
              { value: "off", label: t("settingsRows:services.routing.optOff") },
            ]}
          />
        )
      }
    >
      {error ? <ErrorLine>{t("settingsRows:services.routing.saveFailed")}</ErrorLine> : null}
      {routing ? (
        <p className="t-caption" style={{ margin: 0 }} data-testid="routing-admin-effective">
          {routingEffectiveText(t, routing)}
        </p>
      ) : null}
    </SettingItem>
  );
}
