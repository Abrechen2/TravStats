import { useNavigate } from "react-router-dom";
import type { JSX } from "react";
import type { Cruise } from "../types/cruise";
import { formatDateInTimezone } from "../lib/dateUtils";
import { formatAmount } from "../lib/units";
import { useTranslation } from "../hooks/useTranslation";
import { cruiseStatusPillStyle } from "./Cruise/cruiseStatusStyle";

interface CruiseTooltipProps {
  cruise: Cruise;
  onClose: () => void;
}

/**
 * Floating info card shown when a cruise is selected on the dashboard map.
 * Anchored to the bottom-centre of the viewport rather than a click
 * coordinate — cruise legs span thousands of kilometres, so a position
 * tied to the click point would rarely be where the user is looking.
 * Mirrors the affordances of flight `MapTooltip`: summary stats + a
 * primary "Details" action (→ cruise detail page).
 */
export function CruiseTooltip({ cruise, onClose }: CruiseTooltipProps): JSX.Element {
  const { t, i18n } = useTranslation(["cruise", "common"]);
  const navigate = useNavigate();

  const shipName = cruise.ship?.name ?? cruise.shipNameOverride ?? "—";
  const cruiseLine = cruise.cruiseLine ?? cruise.ship?.cruiseLine ?? "";
  const ports = cruise.stops.filter((s) => !s.isAtSea).length;
  const seaDays = cruise.stops.filter((s) => s.isAtSea).length;
  const startDate = cruise.startDate ? formatDateInTimezone(cruise.startDate, "UTC") : "—";
  const endDate = cruise.endDate ? formatDateInTimezone(cruise.endDate, "UTC") : "—";
  const price =
    cruise.price !== null
      ? formatAmount(cruise.price, cruise.currency, { compact: true, language: i18n.language })
      : null;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 24,
        transform: "translateX(-50%)",
        zIndex: 100,
        background: "rgba(15,23,42,0.95)",
        border: "1px solid var(--accent)",
        borderRadius: 10,
        padding: "12px 16px",
        minWidth: 320,
        maxWidth: 460,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        backdropFilter: "blur(12px)",
        color: "var(--text-primary)",
        fontFamily: "Inter, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span aria-hidden style={{ fontSize: 18 }}>
          ⚓
        </span>
        <strong style={{ flex: 1, fontSize: 14 }}>{shipName}</strong>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold"
          style={cruiseStatusPillStyle(cruise.status)}
        >
          {t(`cruise:status.${cruise.status}`)}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common:buttons.close", { defaultValue: "Close" })}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>

      {cruiseLine !== "" && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
          {cruiseLine}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        <span style={chipStyle}>
          {startDate} – {endDate}
        </span>
        <span style={chipStyle}>
          {ports} {t("cruise:field.ports", { count: ports })}
        </span>
        <span style={chipStyle}>
          {seaDays} {t("cruise:field.sea_days", { count: seaDays })}
        </span>
        {price !== null && <span style={chipStyle}>{price}</span>}
      </div>

      <button
        type="button"
        onClick={() => navigate(`/cruises/${cruise.id}`)}
        className="btn-primary"
        style={{ fontSize: 13, padding: "6px 14px" }}
      >
        {t("common:buttons.details", { defaultValue: "Details" })} →
      </button>
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted)",
  background: "var(--bg-muted)",
  borderRadius: 6,
  padding: "2px 8px",
};
