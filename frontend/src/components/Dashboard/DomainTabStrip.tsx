import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import type { DashboardTab } from "../../types/dashboard";
import type { UpcomingEntry } from "../../lib/api/upcoming";
import { NextUpEntry } from "./NextUpEntry";
import { DASHBOARD_TABS } from "../../types/dashboard";
import { isValidDomain, type DomainKey } from "../../shared/domains";

interface DomainTabStripProps {
  active: DashboardTab;
  /**
   * Keyed by `DomainKey`, NOT `Exclude<DashboardTab, "all">` — a dashboard
   * tab is not a domain (types/dashboard.ts), and the "Touren" tab is the
   * proof: it has no count badge and no enable/disable pill, because it has
   * no domain to count or disable. Widening this to every non-"all" tab
   * would force a fake count for a tab that doesn't have one.
   */
  counts: Record<DomainKey, number>;
  /**
   * How many of `counts` are merely planned (per domain, optional). Shown as
   * a "(n geplant)" hint so the tab count and the statistics stop appearing
   * to contradict each other — "Flüge 1" next to "keine Daten" is factually
   * consistent (statistics count flown things) but reads like a bug without
   * the hint (UAT finding B6).
   */
  scheduledCounts?: Partial<Record<DomainKey, number>>;
  enabled: Record<DomainKey, boolean>;
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
  tour: "🧭",
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
  const { isFeatureVisible } = useBetaFeatures();

  // The instance beta flag ALONE, deliberately not the enabled state. This
  // strip already receives `enabled` as a prop, and its contract is that a
  // domain the user has switched off is DIMMED, not hidden — that is what lets
  // them click through to the "coming soon" screen and turn it back on. Mixing
  // the enabled state in here would hide the tab instead and break that.
  //
  // "Touren" is the one tab still gated: the feature is complete, the gate is
  // only withholding it until the owner's release decision
  // (config/betaFeatures.ts). Places sat behind a gate of the same shape
  // (`poiDomain`) until 2026-09-05, when its own condition — the CSV import
  // getting a surface — was met.
  const visibleTabs = DASHBOARD_TABS.filter(
    (tab) => tab !== "tour" || isFeatureVisible("tourRoutes")
  );

  // On a domain tab, that domain's next entry; on "Alle", the soonest of all —
  // including the trip, which belongs to no single tab. `upcoming` arrives
  // sorted, so "the soonest" is simply the first one.
  //
  // `isValidDomain(active)` narrows `active` from `DashboardTab` to
  // `DomainKey` before the comparison below, rather than comparing
  // `entry.domain` (`DomainKey | "trip"`) against the wider `DashboardTab`
  // directly. The two unions only partially overlap (every DashboardTab
  // value up to "Touren" is also a DomainKey; "tour" and "all" are not, and
  // "trip" is a valid `entry.domain` no tab is ever named), so the bare
  // comparison happened to be correct only because "tour"/"all" never equal
  // any real `entry.domain` -- not because the types actually matched. A
  // domain-less tab has no upcoming entry by construction (see
  // `UpcomingEntry.domain`), so the `else` branch here returns that
  // directly rather than relying on `.find()` to fail silently.
  const nextUp =
    active === "all"
      ? upcoming[0]
      : isValidDomain(active)
        ? upcoming.find((entry) => entry.domain === active)
        : undefined;

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
        // `tab` ranges over every DASHBOARD_TAB, but `enabled`/`counts` are
        // keyed by DOMAIN — "Touren" is a tab with no domain behind it, so it
        // is never dimmed (there is nothing to disable) and never carries a
        // count badge (there is nothing this strip fetched to count).
        const domain = isValidDomain(tab) ? tab : null;
        const isDisabled = domain !== null && !enabled[domain];
        const count = domain === null ? null : counts[domain];
        const scheduled = domain === null ? 0 : (scheduledCounts?.[domain] ?? 0);
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
