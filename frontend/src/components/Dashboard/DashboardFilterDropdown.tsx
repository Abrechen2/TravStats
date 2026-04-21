import { useEffect, useRef } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { DashboardTab } from "../../types/dashboard";
import { useDashboardFilterStore } from "../../store/dashboardFilterStore";

interface DashboardFilterDropdownProps {
  tab: DashboardTab;
  open: boolean;
  onClose(): void;
}

export function DashboardFilterDropdown({
  tab,
  open,
  onClose,
}: DashboardFilterDropdownProps): JSX.Element | null {
  const { t } = useTranslation(["dashboard"]);
  const containerRef = useRef<HTMLDivElement>(null);

  const time = useDashboardFilterStore((s) => s.time);
  const setTimeRange = useDashboardFilterStore((s) => s.setTimeRange);
  const flight = useDashboardFilterStore((s) => s.flight);
  const setFlightFilter = useDashboardFilterStore((s) => s.setFlightFilter);
  const cruise = useDashboardFilterStore((s) => s.cruise);
  const setCruiseFilter = useDashboardFilterStore((s) => s.setCruiseFilter);

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
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: 16,
        width: 320,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
          {t("dashboard:filter.timeFrom")}
        </label>
        <input
          type="date"
          value={time.from ?? ""}
          onChange={(e) => setTimeRange(e.target.value || null, time.to)}
          style={{ width: "100%", marginBottom: 8 }}
        />
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
          {t("dashboard:filter.timeTo")}
        </label>
        <input
          type="date"
          value={time.to ?? ""}
          onChange={(e) => setTimeRange(time.from, e.target.value || null)}
          style={{ width: "100%" }}
        />
      </div>

      {tab === "flight" && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
            {t("dashboard:filter.airline")}
          </label>
          <input
            type="text"
            value={flight.airline ?? ""}
            onChange={(e) => setFlightFilter({ airline: e.target.value || undefined })}
            style={{ width: "100%" }}
          />
        </div>
      )}

      {tab === "cruise" && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
            {t("dashboard:filter.cruiseLine")}
          </label>
          <input
            type="text"
            value={cruise.cruiseLine ?? ""}
            onChange={(e) => setCruiseFilter({ cruiseLine: e.target.value || undefined })}
            style={{ width: "100%" }}
          />
        </div>
      )}
    </div>
  );
}
