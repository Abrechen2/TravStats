import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { DashboardTab } from "../../types/dashboard";
import type { UpcomingEntry } from "../../lib/api/upcoming";
import { NextUpEntry } from "./NextUpEntry";
import { DASHBOARD_TABS } from "../../types/dashboard";

interface DomainTabStripProps {
  active: DashboardTab;
  counts: Record<Exclude<DashboardTab, "all">, number>;
  /**
   * How many of `counts` are merely planned (per domain, optional). Shown as
   * a "(n geplant)" hint so the tab count and the statistics stop appearing
   * to contradict each other — "Flüge 1" next to "keine Daten" is factually
   * consistent (statistics count flown things) but reads like a bug without
   * the hint (UAT finding B6).
   */
  scheduledCounts?: Partial<Record<Exclude<DashboardTab, "all">, number>>;
  enabled: Record<Exclude<DashboardTab, "all">, boolean>;
  onSelect(next: DashboardTab): void;
  /**
   * At most one upcoming entry per domain, soonest first. The strip shows the
   * one belonging to the ACTIVE tab, or the soonest of all on "Alle" — the
   * next thing that concerns whatever the user is looking at.
   */
  upcoming?: readonly UpcomingEntry[];
  /** Now, as a timestamp — injected so the countdown is testable. */
  nowMs?: number;
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
  scheduledCounts,
  enabled,
  onSelect,
  upcoming = [],
  nowMs = Date.now(),
}: DomainTabStripProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);

  // Every tab is real now — the POI stub that used to hide behind
  // `poiDashboardTab` was replaced by the Places domain, so the gate and its
  // registry entry are gone. Domain visibility is the user's own
  // enabled-domains setting, which DashboardLayout already applies.
  const visibleTabs = DASHBOARD_TABS;

  // On a domain tab, that domain's next entry; on "Alle", the soonest of all —
  // including the trip, which belongs to no single tab. `upcoming` arrives
  // sorted, so "the soonest" is simply the first one.
  const nextUp =
    active === "all" ? upcoming[0] : upcoming.find((entry) => entry.domain === active);

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
        alignItems: "center",
        fontSize: "13px",
        overflowX: "auto",
        whiteSpace: "nowrap",
      }}
    >
      {visibleTabs.map((tab) => {
        const isActive = tab === active;
        const isDisabled = tab !== "all" && !enabled[tab];
        const count = tab === "all" ? null : counts[tab];
        const scheduled = tab === "all" ? 0 : (scheduledCounts?.[tab] ?? 0);
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
                {scheduled > 0 && (
                  <span style={{ marginLeft: 4, fontFamily: "inherit" }}>
                    {t("dashboard:tabStrip.scheduledHint", { count: scheduled })}
                  </span>
                )}
              </span>
            )}
          </button>
        );
      })}
      {nextUp && <NextUpEntry entry={nextUp} nowMs={nowMs} />}
    </div>
  );
}
