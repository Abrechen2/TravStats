import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { formatDateInTimezone } from "../../../lib/dateUtils";
import type { Cruise } from "../../../types/cruise";

interface CruiseListPanelProps {
  cruises: Cruise[];
  isOpen: boolean;
  onClose(): void;
  /** Single click on a row — selects the cruise on the map (highlight). */
  onSelect?(cruise: Cruise): void;
  /** Details button — navigates to the cruise detail page. */
  onDetails?(cruise: Cruise): void;
}

export function CruiseListPanel({
  cruises,
  isOpen,
  onClose,
  onSelect,
  onDetails,
}: CruiseListPanelProps): JSX.Element | null {
  const { t } = useTranslation(["dashboard", "common"]);
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        width: 320,
        background: "rgba(22,27,34,0.95)",
        borderRight: "1px solid var(--color-border)",
        zIndex: 20,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <strong>{t("dashboard:sidebar.cruises")}</strong>
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          style={{
            background: "none",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            fontSize: 18,
          }}
        >
          ×
        </button>
      </div>
      {cruises.length === 0 ? (
        <p style={{ padding: 16, color: "var(--text-muted)" }}>
          {t("dashboard:sidebar.emptyCruises")}
        </p>
      ) : (
        cruises.map((c) => {
          const ports = c.stops.filter((s) => !s.isAtSea).length;
          const startLabel = c.startDate ? formatDateInTimezone(c.startDate, "UTC") : "—";
          const title = c.ship?.name ?? c.shipNameOverride ?? c.cruiseLine ?? "Cruise";
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect?.(c)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect?.(c);
                }
              }}
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--color-border)",
                color: "var(--text-primary)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span aria-hidden>⚓</span>
                <strong style={{ flex: 1, fontSize: 13 }}>{title}</strong>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDetails?.(c);
                  }}
                  aria-label={t("common:buttons.details", { defaultValue: "Details" })}
                  title={t("common:buttons.details", { defaultValue: "Details" })}
                  style={{
                    background: "none",
                    border: "1px solid var(--color-border)",
                    borderRadius: 4,
                    padding: "2px 6px",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 11,
                    lineHeight: 1,
                  }}
                >
                  →
                </button>
              </div>
              <div
                style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, marginLeft: 20 }}
              >
                {startLabel} · {ports} {t("dashboard:sidebar.ports")}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
