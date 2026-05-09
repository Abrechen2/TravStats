import { useState, useRef, useEffect } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { AVAILABLE_DOMAINS } from "../../shared/domains";
import { useDashboardFilterStore } from "../../store/dashboardFilterStore";
import type { DashboardMode, DashboardTab } from "../../types/dashboard";
import { TAB_MODE_REGISTRY } from "../../types/dashboard";
import { AddDomainPicker } from "./AddDomainPicker";

type AddableDomain = "flight" | "cruise" | "poi";

interface DashboardControlsBarProps {
  tab: DashboardTab;
  mode: DashboardMode;
  enabledDomains: Record<AddableDomain, boolean>;
  onModeChange(next: DashboardMode): void;
  onFilterOpen(): void;
  onAdd(domain?: AddableDomain): void;
}

export function DashboardControlsBar({
  tab,
  mode,
  enabledDomains,
  onModeChange,
  onFilterOpen,
  onAdd,
}: DashboardControlsBarProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const modeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modeMenuOpen) return;
    const onClickOutside = (e: MouseEvent): void => {
      if (!modeRef.current?.contains(e.target as Node)) setModeMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setModeMenuOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [modeMenuOpen]);

  const modes = TAB_MODE_REGISTRY[tab].modes;

  // Filter-button indicator: any non-default state (year picked or
  // a domain hidden) lights up the button so users can tell at a
  // glance whether they're seeing the full dataset or a filtered slice.
  const filterYear = useDashboardFilterStore((s) => s.year);
  const filterDomains = useDashboardFilterStore((s) => s.domains);
  const yearActive = filterYear !== null;
  const domainsHidden = AVAILABLE_DOMAINS.length - filterDomains.length;
  const domainsFiltered = domainsHidden > 0;
  const filterActive = yearActive || domainsFiltered;

  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        alignItems: "center",
        padding: "8px 16px",
        background: "var(--bg-muted)",
        borderBottom: "1px solid var(--color-border)",
        flexWrap: "wrap",
      }}
    >
      {/* Mode dropdown */}
      <div ref={modeRef} style={{ position: "relative" }}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={modeMenuOpen}
          onClick={() => setModeMenuOpen((prev) => !prev)}
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--color-border)",
            padding: "6px 12px",
            borderRadius: "10px",
            color: "var(--text-primary)",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          {t("dashboard:controls.mode")}: <strong>{t(`dashboard:modes.${mode}`)}</strong> {"\u25be"}
        </button>
        {modeMenuOpen && (
          <ul
            role="menu"
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              background: "var(--bg-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "10px",
              listStyle: "none",
              margin: 0,
              padding: "4px 0",
              minWidth: "200px",
              zIndex: 40,
            }}
          >
            {modes.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onModeChange(m as DashboardMode);
                    setModeMenuOpen(false);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 14px",
                    background: m === mode ? "var(--bg-muted)" : "transparent",
                    color: "var(--text-primary)",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "13px",
                  }}
                >
                  {t(`dashboard:modes.${m}`)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Filter button \u2014 lights up + carries an active-state suffix
          when the year or domain filter has been narrowed. */}
      <button
        type="button"
        onClick={onFilterOpen}
        aria-pressed={filterActive}
        style={{
          background: filterActive ? "var(--map-active-bg, rgba(240,169,71,0.14))" : "var(--bg-surface)",
          border: filterActive
            ? "1px solid var(--accent)"
            : "1px solid var(--color-border)",
          padding: "6px 12px",
          borderRadius: "10px",
          color: filterActive ? "var(--accent)" : "var(--text-primary)",
          fontSize: "13px",
          fontWeight: filterActive ? 600 : 400,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {t("dashboard:controls.filter")}
        {yearActive && <span>{filterYear}</span>}
        {domainsFiltered && (
          <span
            aria-label={t("dashboard:filter.activeDomainCount", {
              count: filterDomains.length,
              total: AVAILABLE_DOMAINS.length,
            })}
            style={{
              background: "var(--accent)",
              color: "#0d1117",
              borderRadius: 999,
              padding: "1px 6px",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {filterDomains.length}/{AVAILABLE_DOMAINS.length}
          </span>
        )}
        {"\u25be"}
      </button>

      {/* Add action — domain-specific button or universal picker */}
      <div style={{ marginLeft: "auto" }}>
        {tab === "all" ? (
          <AddDomainPicker enabled={enabledDomains} onPick={(domain) => onAdd(domain)} />
        ) : (
          <button
            type="button"
            onClick={() => onAdd()}
            style={{
              background: "var(--accent)",
              color: "#0d1117",
              padding: "6px 12px",
              borderRadius: "10px",
              fontSize: "13px",
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
            }}
          >
            + {t(`dashboard:controls.addPerTab.${tab}`)}
          </button>
        )}
      </div>
    </div>
  );
}
