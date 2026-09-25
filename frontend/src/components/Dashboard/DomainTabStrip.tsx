import type { JSX } from "react";
import { useToursVisible } from "../../hooks/useToursVisible";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import type { DashboardTab } from "../../types/dashboard";
import type { UpcomingEntry } from "../../lib/api/upcoming";
import { NextUpEntry } from "./NextUpEntry";
import { Icon, type IconName } from "../ui/Icon";
import { DASHBOARD_TABS } from "../../types/dashboard";
import { DOMAINS, isValidDomain, type DomainKey } from "../../shared/domains";
import { useRailOffered } from "../../hooks/useRailVisible";

/** A domain with a dashboard tab of its own. */
type TabDomain = Extract<DashboardTab, DomainKey>;

interface DomainTabStripProps {
  active: DashboardTab;
  /**
   * Keyed by `DomainKey`, NOT `Exclude<DashboardTab, "all">` — a dashboard
   * tab is not a domain (types/dashboard.ts), and the "Touren" tab is the
   * proof: it has no count badge and no enable/disable pill, because it has
   * no domain to count or disable. Widening this to every non-"all" tab
   * would force a fake count for a tab that doesn't have one.
   */
  counts: Record<TabDomain, number>;
  /**
   * What is still ahead per domain (optional). Shown as a "geplant" hint so
   * the tab count and the statistics stop appearing to contradict each other —
   * "Flüge 1" next to "keine Daten" is factually consistent (statistics count
   * flown things) but reads like a bug without the hint (UAT finding B6).
   *
   * See `PLANNED_IS_INCLUDED` for why the same number is worded two ways.
   */
  scheduledCounts?: Partial<Record<TabDomain, number>>;
  enabled: Record<TabDomain, boolean>;
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

/**
 * Whether a domain's planned figure is already INSIDE its count badge.
 *
 * Flights and cruises list every row, planned ones included, so the hint names
 * a SUBSET of the number beside it. Lodging counts houses the user has BEEN to
 * (`shared/lodgingCounting.ts` — a stay counts only once its check-out is
 * past), so a house with nothing but future stays is missing from that number
 * and the hint has to ADD to it. One wording for both would be wrong for one
 * of them, and wrong in the direction the tester already read it: on
 * 2026-09-21 the strip named his next stay on the right ("in 5 Tagen") and
 * said nothing at all on the left, which he read as the planned figure
 * working for flights only.
 *
 * A domain absent here has no planned figure to show.
 */
const PLANNED_IS_INCLUDED: Partial<Record<DomainKey, boolean>> = {
  flight: true,
  cruise: true,
  lodging: false,
};

/** Line icons, as the logbook tabs; "Alle" carries none, as in round 4. */
const TAB_ICON: Record<DashboardTab, IconName | null> = {
  all: null,
  flight: "plane",
  cruise: "ship",
  poi: "map-pin",
  lodging: "bed",
  roadtrip: "caravan",
  rail: "train-front",
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
  // "Touren" and "Roadtrips" went back behind the beta switch on 2026-09-24
  // (owner), and rail sits behind its own `railDomain` switch (owner rule
  // 2026-09-25) — hidden, not dimmed: dimming is for a domain the USER
  // switched off and can turn back on, and a closed instance gate is neither.
  const toursVisible = useToursVisible();
  const railOffered = useRailOffered();
  const visibleTabs = DASHBOARD_TABS.filter((tab) => {
    if (tab === "tour" || tab === "roadtrip") return toursVisible;
    if (tab === "rail") return railOffered;
    return true;
  });

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
        const domain = isValidDomain(tab) ? (tab as TabDomain) : null;
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
            // No `aria-disabled`: the tab IS operable, and says where it
            // goes. It carried one while the click did nothing, which was at
            // least honest then; keeping it once the click reaches the notice
            // would tell assistive tech to skip the only route back to the
            // switch (review, 2026-09-19). `data-disabled` stays -- it is
            // what dims the tab, and dimming is a fact about the AREA, not a
            // claim about this control.
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
                    {t(
                      domain !== null && PLANNED_IS_INCLUDED[domain] === true
                        ? "dashboard:tabStrip.scheduledHint"
                        : "dashboard:tabStrip.plannedExtraHint",
                      { count: scheduled }
                    )}
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
