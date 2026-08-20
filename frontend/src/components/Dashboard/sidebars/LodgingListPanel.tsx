import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { lodgingTypeIcon } from "../../../lib/lodgingFormat";
import type { Lodging } from "../../../types/lodging";

interface LodgingListPanelProps {
  lodgings: readonly Lodging[];
  isOpen: boolean;
  onClose(): void;
}

/**
 * Lodging list sidebar (name / chain / city / nights / rating). Mirrors
 * `CruiseListPanel`'s structure. Every row links to `/lodging/:id` (#259) —
 * especially the coordinate-less ones, which additionally carry the same
 * "Nicht gefunden" marker as the logbook list: a row the map can't focus
 * must still lead somewhere the missing location can be fixed.
 */
export function LodgingListPanel({
  lodgings,
  isOpen,
  onClose,
}: LodgingListPanelProps): JSX.Element | null {
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
        // Solid, not translucent — this sidebar sits directly over the
        // map's own FlatMapControlPanel (bottom-left, same left column,
        // open by default on this tab). A translucent background let that
        // panel's "Karte / Modus / Filter / Ebenen" text bleed through as
        // faded ghost text underneath the hotel list (finding: dashboard
        // ghost-text bleed-through).
        background: "var(--bg-surface)",
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
        <strong>{t("dashboard:lodgingTab.listTitle")}</strong>
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
      {lodgings.length === 0 ? (
        <p style={{ padding: 16, color: "var(--text-muted)" }}>
          {t("dashboard:lodgingTab.listEmpty")}
        </p>
      ) : (
        lodgings.map((lodging) => (
          <Link
            key={lodging.id}
            to={`/lodging/${lodging.id}`}
            style={{
              display: "block",
              padding: "12px 16px",
              borderBottom: "1px solid var(--color-border)",
              color: "var(--text-primary)",
              textDecoration: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span aria-hidden>{lodgingTypeIcon(lodging.type)}</span>
              <strong style={{ flex: 1, fontSize: 13 }}>{lodging.name}</strong>
              {lodging.lat === null && (
                <span
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 8,
                    border: "1px solid var(--color-border)",
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t("lodging:list.status.unlocated")}
                </span>
              )}
            </div>
            <div
              style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, marginLeft: 20 }}
            >
              {lodging.chain?.name ?? t("dashboard:lodgingTab.independentChain")}
              {lodging.city ? ` · ${lodging.city}` : ""}
            </div>
            <div
              style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, marginLeft: 20 }}
            >
              {t("lodging:field.nightsCount", { count: lodging.nights })}
              {lodging.overallRating !== null ? ` · ★ ${lodging.overallRating.toFixed(1)}` : ""}
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
