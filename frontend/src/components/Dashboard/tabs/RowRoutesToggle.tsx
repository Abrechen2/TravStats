import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { ROUTE_DOMAINS, type RouteDomain } from "../../../lib/mapRoutes";
import { useMapRoutesStore } from "../../../store/mapRoutesStore";
import type { FilterDomainKey } from "../../../shared/dashboardDomainFilter";

const TOUCH_TARGET = 44;

export function isRouteDomainKey(key: FilterDomainKey): key is RouteDomain {
  return (ROUTE_DOMAINS as readonly string[]).includes(key);
}

/**
 * "Routen" / "Nur Orte" — the two-state switch inside a domain's filter row.
 * It writes the same per-domain flag as the map panel's "Routen" switch
 * (`mapRoutesStore`, one source of truth), so the two can never disagree.
 * Disabled while the current mode is nothing but routes (`blocked`).
 */
export function RowRoutesToggle({
  domain,
  touch,
}: {
  domain: RouteDomain;
  touch: boolean;
}): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const routes = useMapRoutesStore((s) => s.visible[domain]);
  const blocked = useMapRoutesStore((s) => s.blocked);
  const setVisible = useMapRoutesStore((s) => s.setVisible);
  const shown = blocked ? true : routes;
  const places = t(`dashboard:domainFilter.row.places.${domain}`);
  return (
    <button
      type="button"
      aria-pressed={!shown}
      disabled={blocked}
      data-testid={`row-routes-toggle-${domain}`}
      title={
        blocked
          ? t("dashboard:domainFilter.row.routesBlocked")
          : t(
              shown
                ? "dashboard:domainFilter.row.routesHideTooltip"
                : "dashboard:domainFilter.row.routesShowTooltip",
              { places }
            )
      }
      onClick={(e) => {
        e.stopPropagation();
        setVisible(domain, !shown);
      }}
      onKeyDown={(e) => {
        // Only activation stays here (the row would toggle its checkbox);
        // Escape and the arrows must still reach the panel's handlers.
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
      className="cursor-pointer"
      style={{
        background: shown ? "transparent" : "var(--ts-accent)",
        border: "1px solid var(--ts-border)",
        borderRadius: 999,
        color: shown ? "var(--ts-muted)" : "var(--ts-bg)",
        opacity: blocked ? 0.5 : 1,
        fontSize: touch ? 12.5 : 11,
        fontWeight: 600,
        padding: touch ? "0 10px" : "1px 8px",
        minHeight: touch ? TOUCH_TARGET : undefined,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {shown ? t("dashboard:domainFilter.row.routes") : t("dashboard:domainFilter.row.stopsOnly")}
    </button>
  );
}
