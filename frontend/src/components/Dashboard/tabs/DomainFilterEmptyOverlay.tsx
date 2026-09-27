import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";

export interface DomainFilterEmptyOverlayProps {
  isEmpty: boolean;
  onShowAll: () => void;
  onOpenFilter: () => void;
}

/**
 * Decision 6 (`ClaudeDesign/handoff/2026-09-27-dashboard-domain-filter-
 * rueckmeldung.md`): "Karte zentriert 'Keine Domäne ausgewählt', darunter
 * 'Alle einblenden' / 'Auswahl öffnen'" — every row unticked is a normal,
 * saved state, not an error, so this reads as an explanation with a way
 * back, not a warning.
 *
 * `isEmpty` is a prop (rather than the caller conditionally rendering this
 * component at all) so the one call site in `AllTab.tsx` fits the file's
 * 800-line ratchet without an extra wrapping conditional.
 */
export function DomainFilterEmptyOverlay({
  isEmpty,
  onShowAll,
  onOpenFilter,
}: DomainFilterEmptyOverlayProps): JSX.Element | null {
  const { t } = useTranslation(["dashboard"]);
  if (!isEmpty) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 25,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          background: "color-mix(in srgb, var(--ts-surface2) 92%, transparent)",
          border: "1px solid var(--ts-border)",
          borderRadius: "var(--ts-radius-card)",
          padding: "20px 24px",
          textAlign: "center",
          maxWidth: 320,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ts-text-bright)" }}>
          {t("dashboard:domainFilter.empty.title")}
        </div>
        <div style={{ marginTop: 6, fontSize: 13, color: "var(--ts-muted)" }}>
          {t("dashboard:domainFilter.empty.body")}
        </div>
        <div className="flex items-center justify-center" style={{ marginTop: 14, gap: 16 }}>
          <button
            type="button"
            onClick={onShowAll}
            className="cursor-pointer"
            style={{
              background: "var(--ts-accent)",
              color: "var(--ts-accent-text)",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {t("dashboard:domainFilter.empty.showAll")}
          </button>
          <button
            type="button"
            onClick={onOpenFilter}
            className="cursor-pointer"
            style={{
              background: "none",
              border: "none",
              color: "var(--ts-accent)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {t("dashboard:domainFilter.empty.openFilter")}
          </button>
        </div>
      </div>
    </div>
  );
}
