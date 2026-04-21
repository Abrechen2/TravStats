import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import type { Cruise } from "../../../types/cruise";

interface CruiseListPanelProps {
  cruises: Cruise[];
  isOpen: boolean;
  onClose(): void;
}

export function CruiseListPanel({
  cruises,
  isOpen,
  onClose,
}: CruiseListPanelProps): JSX.Element | null {
  const { t } = useTranslation(["dashboard"]);
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
        cruises.map((c) => (
          <Link
            key={c.id}
            to={`/cruises/${c.id}`}
            style={{
              display: "block",
              padding: "12px 16px",
              borderBottom: "1px solid var(--color-border)",
              color: "var(--text-primary)",
              textDecoration: "none",
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {c.ship?.name ?? c.shipNameOverride ?? c.cruiseLine ?? "Cruise"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {c.startDate?.slice(0, 10) ?? "—"} · {c.stops.length} {t("dashboard:sidebar.ports")}
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
