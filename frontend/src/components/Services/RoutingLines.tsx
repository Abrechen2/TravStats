import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { AccountRouting } from "../../lib/api/externalServices";
import { useServices } from "./servicesContext";

/** The three cards that make up "routing" on the services page. */
export const ROUTING_CARDS: ReadonlySet<string> = new Set([
  "openrouteservice",
  "graphhopper",
  "selfHostedRouting",
]);

const PROVIDER_NAME: Record<string, string> = {
  openrouteservice: "OpenRouteService",
  graphhopper: "GraphHopper",
};

function providerName(t: (key: string) => string, id: string): string {
  return id === "custom" ? t("settingsRows:services.routing.ownServer") : PROVIDER_NAME[id];
}

/** One sentence from the server's own resolution: who answers, whose key, whose quota. */
export function routingEffectiveText(
  t: (key: string, o?: Record<string, unknown>) => string,
  routing: AccountRouting
): string {
  if (routing.providerId) {
    const via = t("settingsRows:services.routing.via", {
      provider: providerName(t, routing.providerId),
    });
    const who =
      routing.keySource === "account"
        ? t("settingsRows:services.routing.yourKey")
        : routing.keySource === "instance"
          ? t("settingsRows:services.routing.serverKey")
          : t("settingsRows:services.routing.selfHosted");
    return `${via} · ${who}`;
  }
  return routing.hint === "selectedUnavailable"
    ? t("settingsRows:services.routing.selectedUnavailable", {
        provider: routing.selected ? providerName(t, routing.selected) : "",
      })
    : t("settingsRows:services.routing.noProvider");
}

/** Which provider answers this account, said on each routing card from the same resolution as the pills. */
export default function RoutingLines({ cardId }: { cardId: string }): JSX.Element | null {
  const { t } = useTranslation(["settingsRows"]);
  const { account } = useServices();
  const routing = account.data?.routing;
  if (!routing || !ROUTING_CARDS.has(cardId)) return null;
  return (
    <div className="flex flex-col" style={{ gap: 4 }} data-testid="routing-lines">
      {routing.mode === "auto" ? (
        <p className="t-caption" style={{ margin: 0 }} data-testid="routing-mode-line">
          {t("settingsRows:services.routing.auto")}
        </p>
      ) : null}
      <p className="t-caption" style={{ margin: 0 }} data-testid="routing-effective-line">
        {routingEffectiveText(t, routing)}
      </p>
    </div>
  );
}
