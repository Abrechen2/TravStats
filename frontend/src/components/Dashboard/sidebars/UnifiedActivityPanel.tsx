import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import type { GeoJSONFeature } from "../../../types";
import type { Cruise } from "../../../types/cruise";

interface ActivityItem {
  id: string;
  kind: "flight" | "cruise";
  label: string;
  date: string;
}

interface UnifiedActivityPanelProps {
  flights: GeoJSONFeature[];
  cruises: Cruise[];
  isOpen: boolean;
  onClose(): void;
}

function flightLabel(f: GeoJSONFeature): string {
  const props = (f.properties ?? {}) as Record<string, unknown>;
  const dep = props.departureAirport as { iata?: string } | undefined;
  const arr = props.arrivalAirport as { iata?: string } | undefined;
  return `${dep?.iata ?? "?"} → ${arr?.iata ?? "?"}`;
}

function flightDate(f: GeoJSONFeature): string {
  const props = (f.properties ?? {}) as Record<string, unknown>;
  const d = props.date;
  return typeof d === "string" ? d : "";
}

export function UnifiedActivityPanel({
  flights,
  cruises,
  isOpen,
  onClose,
}: UnifiedActivityPanelProps): JSX.Element | null {
  const { t } = useTranslation(["dashboard"]);
  if (!isOpen) return null;

  const items: ActivityItem[] = [
    ...flights.map((f, i) => ({
      id: `f-${i}`,
      kind: "flight" as const,
      label: flightLabel(f),
      date: flightDate(f),
    })),
    ...cruises.map((c) => ({
      id: `c-${c.id}`,
      kind: "cruise" as const,
      label: c.ship?.name ?? c.shipNameOverride ?? c.cruiseLine ?? "Cruise",
      date: c.startDate?.slice(0, 10) ?? "",
    })),
  ]
    .filter((x) => x.date !== "")
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 50);

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
        <strong>{t("dashboard:sidebar.activity")}</strong>
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
      {items.length === 0 ? (
        <p style={{ padding: 16, color: "var(--text-muted)" }}>
          {t("dashboard:sidebar.emptyActivity")}
        </p>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            style={{
              padding: "10px 16px",
              borderBottom: "1px solid var(--color-border)",
              fontSize: 13,
            }}
          >
            <span style={{ marginRight: 8 }}>{item.kind === "flight" ? "✈" : "⚓"}</span>
            <strong>{item.label}</strong>
            <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>· {item.date}</span>
          </div>
        ))
      )}
    </div>
  );
}
