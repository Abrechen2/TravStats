import { useEffect, useRef, useState, type JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { adminApi } from "../../lib/api/admin";
import { ChoiceControl, ErrorLine, SettingItem } from "../ui/settings";
import { routingEffectiveText } from "./RoutingLines";
import { useServices } from "./servicesContext";

/** `null` in the database is "Automatisch"; "off" is "Aus", chosen on purpose. */
type Choice = "auto" | "openrouteservice" | "graphhopper" | "custom" | "off";

/** `?match=` value that names this row (the readiness item admin.routingKeyUnused links here). */
export const ROUTING_PROVIDER_MATCH = "routingProvider";

interface KeyedProvider {
  id: "openrouteservice" | "graphhopper";
  name: string;
  column: "globalOpenrouteserviceApiKey" | "globalGraphhopperApiKey";
}
const KEYED: readonly KeyedProvider[] = [
  { id: "graphhopper", name: "GraphHopper", column: "globalGraphhopperApiKey" },
  { id: "openrouteservice", name: "OpenRouteService", column: "globalOpenrouteserviceApiKey" },
];

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
  const [keyed, setKeyed] = useState<KeyedProvider[]>([]);
  const [error, setError] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const named =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("match") === ROUTING_PROVIDER_MATCH;
  // Opened from a link that names the choice: bring it into view once it is drawn.
  useEffect(() => {
    if (named && value !== null && typeof anchor.current?.scrollIntoView === "function") {
      anchor.current.scrollIntoView({ block: "center" });
    }
  }, [named, value]);

  useEffect(() => {
    let live = true;
    adminApi
      .getGlobalApiKeys()
      .then((k) => {
        if (!live) return;
        setValue(toChoice(k.routingProvider));
        setKeyed(KEYED.filter((p) => !!k[p.column]));
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
    <div ref={anchor} id="routing-provider" data-named={named ? "" : undefined}>
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
        {value === "auto" && keyed.length > 0 ? (
          // The restore path (#411): the provider went empty while an instance key is
          // stored — one click puts the keyed provider back.
          <div className="t-caption" data-testid="routing-use-keyed" style={{ margin: 0 }}>
            {keyed.map((p) => (
              <p key={p.id} style={{ margin: 0 }}>
                {t("settingsRows:services.routing.emptyWithKey", { provider: p.name })}{" "}
                <button type="button" className="underline" onClick={() => void choose(p.id)}>
                  {t("settingsRows:services.routing.useKeyed", { provider: p.name })}
                </button>
              </p>
            ))}
          </div>
        ) : null}
        {error ? <ErrorLine>{t("settingsRows:services.routing.saveFailed")}</ErrorLine> : null}
        {routing ? (
          <p className="t-caption" style={{ margin: 0 }} data-testid="routing-admin-effective">
            {routingEffectiveText(t, routing)}
          </p>
        ) : null}
      </SettingItem>
    </div>
  );
}
