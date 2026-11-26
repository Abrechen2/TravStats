// Dashboard chrome, folded into the in-map control panel.
//
// The Modus switcher and the year Filter used to live in a toolbar
// above the map (DashboardControlsBar + DashboardFilterDropdown). That
// toolbar is gone — every dashboard mode renders a map with this panel, so
// the panel is the control surface for these two. These sections sit at the
// top of both the globe and the flat-map panel.
//
// The "+ hinzufügen" action does NOT live here — it's a floating top-right
// overlay on the map (AddDomainPicker, mounted by DashboardLayout), a
// deliberately separate, always-reachable control rather than one more
// entry buried in this panel.
//
// Everything here reads global state directly (react-router route + the
// dashboardFilterStore), so there is no prop-drilling through the map tree.
//
// Domain visibility is NOT here. It was, as a row of pills, until 2026-09-28;
// it now belongs to the "Domänen · x/y" filter on the map, which is the one
// place that answers "what is on the map".

import { useYearCounts } from "../../lib/stats/useYearCounts";
import YearPicker from "../ui/YearPicker";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDashboardRoute } from "../../hooks/useDashboardRoute";
import { useDashboardFilterStore } from "../../store/dashboardFilterStore";
import { TAB_MODE_REGISTRY, type DashboardMode } from "../../types/dashboard";
import { SectionLabel, SegControl, ACCENT, HAIRLINE } from "./controlPanelKit";
import { todayZoneNow } from "../../hooks/useTodayZone";
import { todayIn } from "../../shared/time";

const YEAR_RANGE_BACK = 14;

/** Back from the year it is in the profile zone (ADR 0002 Q1). */
function buildYearOptions(): number[] {
  const current = Number(todayIn(todayZoneNow()).slice(0, 4));
  const out: number[] = [];
  for (let y = current; y >= current - YEAR_RANGE_BACK; y -= 1) out.push(y);
  return out;
}

function Section({
  children,
  first = false,
}: {
  children: React.ReactNode;
  first?: boolean;
}): JSX.Element {
  return (
    <div
      style={{ borderTop: `1px solid ${HAIRLINE}` }}
      className={first ? "pt-2.5" : "mt-2.5 pt-2.5"}
    >
      {children}
    </div>
  );
}

export function MapChromeSections(): JSX.Element {
  const { t } = useTranslation(["dashboard", "common"]);
  const yearCounts = useYearCounts().of();
  const { tab, mode, setMode } = useDashboardRoute();

  const year = useDashboardFilterStore((s) => s.year);
  const setYear = useDashboardFilterStore((s) => s.setYear);
  const resetFilter = useDashboardFilterStore((s) => s.reset);

  const modes = TAB_MODE_REGISTRY[tab].modes;
  const yearOptions = buildYearOptions();

  // The year is the only filter this panel still owns, so it alone decides
  // whether "reset" has anything to reset.
  const filterActive = year !== null;

  return (
    <>
      {/* Modus */}
      <Section first>
        <SectionLabel>{t("dashboard:controls.mode")}</SectionLabel>
        <SegControl<DashboardMode>
          value={mode}
          onChange={setMode}
          columns={modes.length > 2 ? 2 : modes.length}
          options={modes.map((m) => ({ value: m, label: t(`dashboard:modes.${m}`) }))}
        />
      </Section>

      {/* Filter -- the year select reaches every tab: the tour and roadtrip tabs filter their
          routes by date like the "Alle" tab does, places by visit date. */}
      <Section>
        <SectionLabel>{t("dashboard:filter.title")}</SectionLabel>
        <div className="flex flex-col gap-2">
          <span className="text-[10px]" style={{ color: "rgba(241,245,249,0.55)" }}>
            {t("dashboard:filter.year")}
          </span>
          <YearPicker
            years={yearOptions.map((y) => ({ year: y, count: yearCounts[y] }))}
            formatCount={(n): string => t("common:yearPicker.count.events", { count: n })}

            value={year ?? "all"}
            onChange={(v): void => setYear(v === "all" ? null : v)}
            label={t("dashboard:filter.year")}
            tone="dark"
          />

          {/* The domain pills that used to sit here are gone (owner,
                2026-09-28). Domain visibility has ONE owner now: the
                "Domänen · x/y" filter on the map. Two controls for one
                question could contradict each other, and the losing one was
                this: it was a second place to hide a domain, invisible from
                the filter that claims to say what is on the map.

                Its stored set had to go with it, not just the buttons — a
                domain someone had deselected here would otherwise have stayed
                hidden forever, with no control left to bring it back. */}

          {filterActive && (
            <button
              type="button"
              onClick={resetFilter}
              className="cursor-pointer self-start text-[10px] underline opacity-80 hover:opacity-100"
              style={{ color: `rgb(${ACCENT})` }}
            >
              {t("dashboard:filter.reset")}
            </button>
          )}
        </div>
      </Section>
    </>
  );
}
