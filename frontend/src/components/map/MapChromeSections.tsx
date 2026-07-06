// Dashboard chrome, folded into the in-map control panel.
//
// The Modus switcher, the year/domain Filter, and the "+ hinzufügen"
// action used to live in a toolbar above the map (DashboardControlsBar +
// DashboardFilterDropdown). Both are gone — every dashboard mode renders a
// map with this panel, so the panel is the single, always-present control
// surface. These three sections sit at the top of both the globe and the
// flat-map panel.
//
// Everything here reads global state directly (react-router route + the
// two Zustand stores), so there is no prop-drilling through the map tree.
// The one thing the panel can't do locally — open an add-modal — is
// bridged through useDashboardChromeStore (see that file).

import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useDashboardRoute } from "../../hooks/useDashboardRoute";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { useDashboardFilterStore } from "../../store/dashboardFilterStore";
import { useDashboardChromeStore, type AddableDomain } from "../../store/dashboardChromeStore";
import { TAB_MODE_REGISTRY, type DashboardMode } from "../../types/dashboard";
import { AVAILABLE_DOMAINS, DOMAINS, type DomainKey } from "../../shared/domains";
import { SectionLabel, SegControl, ACCENT, HAIRLINE, BORDER, TEXT } from "./controlPanelKit";

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
  const requestAdd = useDashboardChromeStore((s) => s.requestAdd);

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

  // Which "+ hinzufügen" buttons to show: on the Alle tab one per enabled
  // domain; on a single-domain tab just that domain (the panel only renders
  // when the tab's domain is enabled, so no gating needed here).
  const addDomains: AddableDomain[] =
    tab === "all"
      ? (domainOptions.filter((d) => d !== "poi") as AddableDomain[])
      : [tab as AddableDomain];

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

      {/* Filter */}
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
              <option value="">{t("dashboard:filter.allYears")}</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
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

      {/* Add */}
      <Section>
        <div className="flex flex-wrap gap-1.5">
          {addDomains.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => requestAdd(d)}
              className="flex-1 cursor-pointer rounded-md px-2 py-1.5 text-[11px] font-semibold transition-opacity hover:opacity-90"
              style={{ background: `rgb(${ACCENT})`, color: "#0d1117", border: "none" }}
            >
              + {t(`dashboard:addPicker.${d}`)}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}
