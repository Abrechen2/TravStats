// Dashboard chrome, folded into the in-map control panel.
//
// The Modus switcher and the year/domain Filter used to live in a toolbar
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

import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDashboardRoute } from "../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useDashboardFilterStore } from "../../store/dashboardFilterStore";
import { TAB_MODE_REGISTRY, type DashboardMode } from "../../types/dashboard";
import { AVAILABLE_DOMAINS, DOMAINS, type DomainKey } from "../../shared/domains";
import {
  SectionLabel,
  SegControl,
  ACCENT,
  HAIRLINE,
  BORDER,
  TEXT,
  PANEL_OPTION_STYLE,
} from "./controlPanelKit";

const YEAR_RANGE_BACK = 14;

function buildYearOptions(): number[] {
  const current = new Date().getFullYear();
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
  const { tab, mode, setMode } = useDashboardRoute();
  const { isEnabled } = useEnabledDomains();

  const year = useDashboardFilterStore((s) => s.year);
  const setYear = useDashboardFilterStore((s) => s.setYear);
  const domains = useDashboardFilterStore((s) => s.domains);
  const setDomains = useDashboardFilterStore((s) => s.setDomains);
  const resetFilter = useDashboardFilterStore((s) => s.reset);

  const modes = TAB_MODE_REGISTRY[tab].modes;
  const yearOptions = buildYearOptions();

  const domainOptions = AVAILABLE_DOMAINS.filter((key) => isEnabled(key));
  const yearActive = year !== null;
  const domainsFiltered = tab === "all" && domainOptions.some((key) => !domains.includes(key));
  const filterActive = yearActive || domainsFiltered;

  const toggleDomain = (key: DomainKey): void => {
    const next = domains.includes(key) ? domains.filter((d) => d !== key) : [...domains, key];
    setDomains(next);
  };

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

      {/* Filter -- hidden entirely on the tour tab: the year select has no
          effect on `useDashboardTours` (no date param exists on that
          endpoint, see TourTab.tsx's own concerns section), and the domain
          pills are already `tab === "all"`-only above. A control that
          visibly does nothing is the same defect this feature's tour
          legend was fixed for -- offering it here would be the same lie
          about a different control (fix-round review, 2026-08-30). */}
      {tab !== "tour" && (
        <Section>
          <SectionLabel>{t("dashboard:filter.title")}</SectionLabel>
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span style={{ color: "rgba(241,245,249,0.55)" }} className="text-[10px]">
                {t("dashboard:filter.year")}
              </span>
              <select
                value={year ?? ""}
                onChange={(e) => setYear(e.target.value === "" ? null : Number(e.target.value))}
                className="cursor-pointer rounded-md px-2 py-1.5 text-[11px]"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: `1px solid ${BORDER}`,
                  color: TEXT,
                  colorScheme: "dark",
                }}
              >
                {/* Options MUST be styled explicitly — the popup ignores the
                  select's colours on Windows and was white-on-white (#196). */}
                <option value="" style={PANEL_OPTION_STYLE}>
                  {t("dashboard:filter.allYears")}
                </option>
                {yearOptions.map((y) => (
                  <option key={y} value={y} style={PANEL_OPTION_STYLE}>
                    {y}
                  </option>
                ))}
              </select>
            </label>

            {tab === "all" && (
              <div className="flex flex-col gap-1">
                <span style={{ color: "rgba(241,245,249,0.55)" }} className="text-[10px]">
                  {t("dashboard:filter.domains")}
                </span>
                <div className="flex flex-wrap gap-1">
                  {domainOptions.map((key) => {
                    const active = domains.includes(key);
                    const descriptor = DOMAINS[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleDomain(key)}
                        className="cursor-pointer rounded-full px-2.5 py-1 text-[11px] transition-colors"
                        style={{
                          background: active ? descriptor.color : "transparent",
                          color: active ? "#0d1117" : "rgba(241,245,249,0.6)",
                          border: `1px solid ${active ? descriptor.color : BORDER}`,
                          fontWeight: active ? 600 : 400,
                        }}
                      >
                        {t(`common:${descriptor.i18nKey}`)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
      )}
    </>
  );
}
