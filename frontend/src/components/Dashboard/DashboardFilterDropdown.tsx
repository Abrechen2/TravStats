import { useEffect, useMemo, useRef } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { DashboardTab } from "../../types/dashboard";
import { useDashboardFilterStore } from "../../store/dashboardFilterStore";
import { AVAILABLE_DOMAINS, DOMAINS, type DomainKey } from "../../shared/domains";

interface DashboardFilterDropdownProps {
  tab: DashboardTab;
  open: boolean;
  onClose(): void;
}

const inputStyle = {
  width: "100%",
  background: "var(--bg-base)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  padding: "6px 8px",
  color: "var(--text-primary)",
  fontSize: 13,
  colorScheme: "dark" as const,
};

const labelStyle = {
  display: "block",
  fontSize: 12,
  color: "var(--text-muted)",
  marginBottom: 4,
};

// Year dropdown range — anchored at the current year and stretching
// 14 years back, which covers the realistic logbook horizon for a
// solo traveller without making the dropdown unwieldy.
const YEAR_RANGE_BACK = 14;

function buildYearOptions(): number[] {
  const current = new Date().getFullYear();
  const out: number[] = [];
  for (let y = current; y >= current - YEAR_RANGE_BACK; y -= 1) {
    out.push(y);
  }
  return out;
}

export function DashboardFilterDropdown({
  tab,
  open,
  onClose,
}: DashboardFilterDropdownProps): JSX.Element | null {
  const { t } = useTranslation(["dashboard"]);
  const containerRef = useRef<HTMLDivElement>(null);

  const year = useDashboardFilterStore((s) => s.year);
  const setYear = useDashboardFilterStore((s) => s.setYear);
  const domains = useDashboardFilterStore((s) => s.domains);
  const setDomains = useDashboardFilterStore((s) => s.setDomains);
  const flight = useDashboardFilterStore((s) => s.flight);
  const setFlightFilter = useDashboardFilterStore((s) => s.setFlightFilter);
  const cruise = useDashboardFilterStore((s) => s.cruise);
  const setCruiseFilter = useDashboardFilterStore((s) => s.setCruiseFilter);

  const yearOptions = useMemo(() => buildYearOptions(), []);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent): void => {
      if (!containerRef.current?.contains(e.target as Node)) onClose();
    };
    const onEscape = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, onClose]);

  if (!open) return null;

  const toggleDomain = (key: DomainKey): void => {
    const isOn = domains.includes(key);
    const next = isOn ? domains.filter((d) => d !== key) : [...domains, key];
    setDomains(next);
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={t("dashboard:filter.title")}
      style={{
        position: "absolute",
        top: 48,
        left: 120,
        zIndex: 40,
        background: "var(--bg-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: 16,
        width: 320,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle} htmlFor="dashboard-filter-year">
          {t("dashboard:filter.year")}
        </label>
        <select
          id="dashboard-filter-year"
          value={year ?? ""}
          onChange={(e) => setYear(e.target.value === "" ? null : Number(e.target.value))}
          style={inputStyle}
        >
          <option value="">{t("dashboard:filter.allYears")}</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {tab === "all" && (
        <div style={{ marginBottom: 16 }}>
          <span style={labelStyle}>{t("dashboard:filter.domains")}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {AVAILABLE_DOMAINS.map((key) => {
              const active = domains.includes(key);
              const descriptor = DOMAINS[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleDomain(key)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    cursor: "pointer",
                    background: active ? descriptor.color : "transparent",
                    color: active ? "#0d1117" : "var(--text-secondary)",
                    border: `1px solid ${active ? descriptor.color : "var(--color-border)"}`,
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {t(descriptor.i18nKey)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tab === "flight" && (
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>{t("dashboard:filter.airline")}</label>
          <input
            type="text"
            value={flight.airline ?? ""}
            onChange={(e) => setFlightFilter({ airline: e.target.value || undefined })}
            style={inputStyle}
          />
        </div>
      )}

      {tab === "cruise" && (
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>{t("dashboard:filter.cruiseLine")}</label>
          <input
            type="text"
            value={cruise.cruiseLine ?? ""}
            onChange={(e) => setCruiseFilter({ cruiseLine: e.target.value || undefined })}
            style={inputStyle}
          />
        </div>
      )}
    </div>
  );
}
