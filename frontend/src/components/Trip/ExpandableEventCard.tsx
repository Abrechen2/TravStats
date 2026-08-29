// A timeline entry that opens in place.
//
// Why this exists: a cruise on a trip's timeline could not be opened at all —
// neither viewed nor edited — while the hotel entry two cards below navigated
// to its own page. The flight was equally dead. Rather than send the reader
// away from the trip, the entry expands where it stands and carries a link to
// the full page inside the panel.
//
// THE LINK IS NOT INSIDE THE BUTTON, and that is the load-bearing detail. This
// project has already shipped the other arrangement once: a clickable row
// swallowed the actions inside it, so "delete" opened the flight it was meant
// to delete, with every test green. An <a> inside a <button> is also invalid
// HTML — the browser resolves it by ignoring one of them, and which one is not
// something to leave to chance. The toggle button covers the header row only;
// the panel is its sibling.

import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";

export interface ExpandableEventCardProps {
  icon: string;
  bg: string;
  iconColor: string;
  title: string;
  subtitle?: string | null;
  date: string;
  /** Overrides the rendered date text, exactly as the plain EventCard's does. */
  dateLabel?: string;
  expanded: boolean;
  onToggle: () => void;
  /** Accessible name for the toggle, e.g. "show details". */
  detailsLabel: string;
  /** The panel. Rendered only while open, and never inside the button. */
  children: ReactNode;
}

export function ExpandableEventCard({
  icon,
  bg,
  iconColor,
  title,
  subtitle,
  date,
  dateLabel,
  expanded,
  onToggle,
  detailsLabel,
  children,
}: ExpandableEventCardProps): JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      className="rounded-xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${title} — ${detailsLabel}`}
        className="w-full text-left px-4 py-3 flex items-start gap-3 rounded-xl"
        style={{ background: "transparent", border: 0, cursor: "pointer" }}
      >
        <span
          className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0"
          style={{ background: bg, color: iconColor }}
        >
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
            {title}
          </div>
          {subtitle && (
            <div className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
              {subtitle}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0 text-right">
          <time
            className="text-[11px] font-mono"
            style={{ color: "var(--text-muted)" }}
            dateTime={date}
          >
            {dateLabel ?? new Date(date).toLocaleDateString()}
          </time>
          <span
            aria-hidden="true"
            className="text-xs"
            style={{
              color: "var(--text-muted)",
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform 120ms",
            }}
          >
            ▾
          </span>
        </div>
      </button>

      {expanded && (
        <div
          className="px-4 pb-3 pt-1"
          style={{ borderTop: "1px solid var(--color-border)" }}
          // Not `role="region"`: the panel is announced through the button's
          // aria-expanded, and a second landmark per timeline row would bury a
          // screen reader in regions on a trip with twenty entries.
        >
          {children}
        </div>
      )}

      {/* A closed card says nothing about what opening it costs; the label above
          is the accessible name, and this is its visible counterpart only when
          the card is open, so the row stays quiet when collapsed. */}
      {expanded && (
        <span className="sr-only">{t("trips:detail.timeline.expandedHint")}</span>
      )}
    </div>
  );
}
