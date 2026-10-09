import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../../hooks/useTranslation";
import type { UpcomingEntry } from "../../lib/api/upcoming";
import { Icon } from "../ui/Icon";
import { nextUpCountdown, nextUpCountdownKey } from "./nextUpCountdown";

/**
 * "Als Nächstes" as a card in the map's right column — the layout Claude
 * Design's round-4 `Dashboard.dc.html` draws: a 240 px column at the map's
 * right edge, reading Als Nächstes → Sichtbar → Legende from the top.
 *
 * It replaces the line that lived at the right end of the domain strip
 * (`NextUpEntry`), which went away with the strip itself.
 *
 * Top-RIGHT, not bottom-left: the card this feature originally had floated
 * over the bottom-left of the map and covered the map-mode switcher
 * completely — 232×39 px, the whole control (reported 2026-08-14). That is
 * what drove it into the strip in the first place. The right column is the
 * one the design reserves for chrome, and the "+ hinzufügen" button above it
 * is cleared by the same `top: 64` offset `GlobeStatsCard` already uses.
 */
const DOMAIN_ICON: Record<UpcomingEntry["domain"], string> = {
  flight: "✈",
  cruise: "⚓",
  lodging: "🏨",
  poi: "📍",
  roadtrip: "🚐",
  rail: "🚆",
  rental: "🚗",
  // B2 (spec 2026-10-07 §8): /upcoming names a bus ride only once B2 lands.
  bus: "🚌",
  trip: "🧳",
};

/** Where a click goes: the ITEM's own page (see NextUpEntry — same rule, #314). */
const DOMAIN_DETAIL_ROUTE: Record<UpcomingEntry["domain"], string> = {
  flight: "/flights",
  cruise: "/cruises",
  lodging: "/lodging",
  poi: "/places",
  roadtrip: "/roadtrips",
  rail: "/rail",
  rental: "/rentals",
  // B2 (spec 2026-10-07 §8): the bus logbook route, once /upcoming carries rides.
  bus: "/bus",
  trip: "/trips",
};

interface MapNextUpCardProps {
  entry: UpcomingEntry;
  /** Now, as a timestamp — passed in so the countdown is testable without faking the clock. */
  nowMs: number;
}

export function MapNextUpCard({ entry, nowMs }: MapNextUpCardProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const navigate = useNavigate();
  const { key, options } = nextUpCountdownKey(nextUpCountdown(entry.startsAt, nowMs));

  return (
    <div
      data-testid="map-next-up-card"
      style={{
        width: 240,
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
        padding: "8px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
      >
        <span className="t-label-mono" style={{ color: "var(--ts-muted)" }}>
          {t("dashboard:nextUp.label")}
        </span>
        <span
          style={{
            fontFamily: "var(--ts-font-mono)",
            fontSize: 11,
            color: "var(--ts-text-bright)",
            whiteSpace: "nowrap",
          }}
        >
          {t(key, options)}
        </span>
      </div>

      <button
        type="button"
        data-testid="next-up-entry"
        onClick={() => navigate(`${DOMAIN_DETAIL_ROUTE[entry.domain]}/${entry.detailId}`)}
        title={entry.secondary ? `${entry.primary} · ${entry.secondary}` : entry.primary}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          color: "var(--ts-text-bright)",
          cursor: "pointer",
          fontSize: 13,
          textAlign: "left",
          overflow: "hidden",
        }}
      >
        <span aria-hidden style={{ opacity: 0.8, flexShrink: 0 }}>
          {DOMAIN_ICON[entry.domain]}
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.primary}
        </span>
        <Icon
          name="chevron-right"
          size={14}
          style={{ marginLeft: "auto", flexShrink: 0, opacity: 0.45 }}
        />
      </button>

      {entry.secondary && (
        <span
          style={{
            fontSize: 12,
            color: "var(--ts-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.secondary}
        </span>
      )}

      {entry.tripName && (
        <span
          data-testid="next-up-trip"
          style={{
            alignSelf: "flex-start",
            maxWidth: "100%",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "1px 6px",
            borderRadius: 999,
            background: "rgba(240,169,71,0.13)",
            color: "var(--accent)",
            fontSize: 12,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          🧳 {entry.tripName}
        </span>
      )}
    </div>
  );
}
