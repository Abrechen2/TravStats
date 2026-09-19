import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import type { DashboardTab } from "../../types/dashboard";
import type { UpcomingEntry } from "../../lib/api/upcoming";
import { NextUpEntry } from "./NextUpEntry";
import { Icon, type IconName } from "../ui/Icon";
import Pill from "../ui/Pill";
import { token } from "../ui/tokens";
import { DASHBOARD_TABS } from "../../types/dashboard";
import { DOMAINS, isValidDomain, type DomainKey } from "../../shared/domains";

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

/** Line icons, as the logbook tabs; "Alle" carries none, as in round 4. */
const TAB_ICON: Record<DashboardTab, IconName | null> = {
  all: null,
  flight: "plane",
  cruise: "ship",
  poi: "map-pin",
  lodging: "bed",
  tour: "route",
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
  const navigate = useNavigate();

  // The instance beta flag ALONE, deliberately not the enabled state. This
  // strip already receives `enabled` as a prop, and its contract is that a
  // domain the user has switched off is DIMMED, not hidden — that is what lets
  // them click through to the "coming soon" screen and turn it back on. Mixing
  // the enabled state in here would hide the tab instead and break that.
  //
  // Every tab is offered now. "Touren" was the last one behind a gate, and
  // the owner released it on 2026-09-18 — as places were released on
  // 2026-09-05 when the CSV import gave them a surface.
  const visibleTabs = DASHBOARD_TABS;

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
      className="flex items-center overflow-x-auto whitespace-nowrap scrollbar-none"
      style={{
        background: "var(--ts-bg)",
        padding: "0 16px",
        borderBottom: "1px solid var(--ts-border)",
        gap: 4,
        fontSize: 14,
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
        const icon = TAB_ICON[tab];
        // A dimmed tab used to be a dead end: `onSelect` navigated to
        // /dashboard/<domain>, and `useDashboardRoute` bounced straight back
        // to /dashboard, so the pointer cursor promised an action that never
        // happened and nothing said why (beta audit 2026-09-19, forgejo#88
        // P5). The click now goes to the domain's OWN route, where
        // `DomainRouteGuard` draws `DomainDisabledNotice` with the link that
        // switches the area back on — and the hint says so before the click.
        const disabledHint = isDisabled ? t("dashboard:tabStrip.disabledHint") : undefined;

        return (
          <button
            key={tab}
            role="tab"
            aria-selected={isActive}
            aria-disabled={isDisabled}
            data-disabled={isDisabled ? "true" : "false"}
            title={disabledHint}
            aria-label={disabledHint === undefined ? undefined : `${label} — ${disabledHint}`}
            onClick={() =>
              isDisabled && domain !== null ? navigate(DOMAINS[domain].routePrefix) : onSelect(tab)
            }
            className="flex shrink-0 items-center"
            style={{
              gap: 8,
              padding: "14px 14px",
              background: "transparent",
              color: isActive ? "var(--ts-text-bright)" : "var(--ts-muted)",
              boxShadow: `inset 0 -2px 0 ${isActive ? "var(--ts-accent)" : "transparent"}`,
              opacity: isDisabled ? 0.55 : 1,
              fontWeight: isActive ? 700 : 500,
              cursor: "pointer",
              border: "none",
              borderRadius: 0,
            }}
          >
            {icon && <Icon name={icon} size={16} />}
            {label}
            {count !== null && (
              <span
                className="t-caption"
                style={{ fontFamily: "var(--ts-font-mono)", fontWeight: 400 }}
              >
                {count}
                {scheduled > 0 && (
                  <span style={{ marginLeft: 4 }}>
                    {t("dashboard:tabStrip.scheduledHint", { count: scheduled })}
                  </span>
                )}
              </span>
            )}
            {tab === "tour" && <Pill color={token("accent")}>Beta</Pill>}
          </button>
        );
      })}
      {nextUp && <NextUpEntry entry={nextUp} nowMs={nowMs} />}
    </div>
  );
}
