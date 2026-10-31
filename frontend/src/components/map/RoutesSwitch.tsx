import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDashboardRoute } from "../../hooks/useDashboardRoute";
import { routesBlockedReason, type RouteDomain } from "../../lib/mapRoutes";
import { useMapRoutesStore } from "../../store/mapRoutesStore";
import { Toggle } from "./controlPanelKit";

/**
 * "Routen" — the panel row that draws a domain's lines or leaves only its
 * markers (airports, ports, stations, stops) and labels. One row per domain
 * that draws a route, at the top of its section; saved at once to the
 * account-synced `mapAppearance` blob through `mapRoutesStore`.
 *
 * It is disabled, with the reason under it, in the modes that are nothing but
 * routes (`routesBlockedReason`) — the alternative is a map that goes empty
 * with no word said.
 */
export function RoutesSwitch({ domain }: { domain: RouteDomain }): JSX.Element {
  const { t } = useTranslation();
  const { tab, mode } = useDashboardRoute();
  const checked = useMapRoutesStore((s) => s.visible[domain]);
  const setVisible = useMapRoutesStore((s) => s.setVisible);
  const blocked = routesBlockedReason(tab, mode);
  return (
    <div className="-mx-1 mb-1.5" data-testid={`routes-switch-${domain}`}>
      <Toggle
        checked={blocked ? true : checked}
        onChange={(v) => setVisible(domain, v)}
        icon="🛤️"
        label={t("map:globe.panel.routes")}
        sub={
          blocked ? t(`map:globe.panel.routesBlocked.${blocked}`) : t("map:globe.panel.routesHint")
        }
        disabled={blocked !== null}
      />
    </div>
  );
}
