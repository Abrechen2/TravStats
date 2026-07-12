import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import type { DashboardTab } from "../../types/dashboard";
import { DASHBOARD_TABS } from "../../types/dashboard";

interface DomainTabStripProps {
  active: DashboardTab;
  counts: Record<Exclude<DashboardTab, "all">, number>;
  enabled: Record<Exclude<DashboardTab, "all">, boolean>;
  onSelect(next: DashboardTab): void;
}

const TAB_ICON: Record<DashboardTab, string> = {
  all: "◎",
  flight: "✈",
  cruise: "⚓",
  poi: "📍",
  lodging: "🏨",
};

export function DomainTabStrip({
  active,
  counts,
  enabled,
  onSelect,
}: DomainTabStripProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const { isFeatureVisible } = useBetaFeatures();

  // The POI tab is a stub (an emoji and "nothing here yet") — don't advertise
  // it unless the instance is flagged beta. See config/betaFeatures.ts.
  const visibleTabs = DASHBOARD_TABS.filter(
    (tab) => tab !== "poi" || isFeatureVisible("poiDashboardTab")
  );

  return (
    <div
      role="tablist"
      aria-label={t("dashboard:tabStrip.label")}
      style={{
        background: "#0b1017",
        padding: "6px 16px",
        borderBottom: "1px solid var(--color-border)",
        display: "flex",
        gap: "4px",
        fontSize: "13px",
        overflowX: "auto",
        whiteSpace: "nowrap",
      }}
    >
      {visibleTabs.map((tab) => {
        const isActive = tab === active;
        const isDisabled = tab !== "all" && !enabled[tab];
        const count = tab === "all" ? null : counts[tab];
        const label = t(`dashboard:tabStrip.tabs.${tab}`);

        return (
          <button
            key={tab}
            role="tab"
            aria-selected={isActive}
            aria-disabled={isDisabled}
            data-disabled={isDisabled ? "true" : "false"}
            onClick={() => onSelect(tab)}
            style={{
              padding: "8px 18px",
              background: "transparent",
              color: isActive ? "var(--accent)" : "var(--text-primary)",
              borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
              opacity: isDisabled ? 0.55 : 1,
              fontWeight: isActive ? 600 : 400,
              cursor: "pointer",
              border: "none",
              borderRadius: 0,
            }}
          >
            <span style={{ marginRight: "6px" }}>{TAB_ICON[tab]}</span>
            {label}
            {count !== null && (
              <span
                style={{
                  marginLeft: "8px",
                  opacity: 0.65,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
