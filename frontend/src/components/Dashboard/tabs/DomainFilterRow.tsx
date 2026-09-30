import type { JSX } from "react";
import { Icon, type IconName } from "../../ui/Icon";
import type { DomainFilterRow as DomainFilterRowData } from "../../../hooks/useDashboardDomainFilter";
import type { FilterDomainKey } from "../../../shared/dashboardDomainFilter";

/** Same glyphs `DomainTabStrip` uses for these seven — one visual vocabulary. */
export const FILTER_ROW_ICON: Record<FilterDomainKey, IconName> = {
  flight: "plane",
  cruise: "ship",
  lodging: "bed",
  poi: "map-pin",
  tour: "route",
  roadtrip: "caravan",
  rail: "train-front",
};

/**
 * Sizes follow the INPUT, not the width. A 40 px row and a 21 px "Nur" button
 * are fine under a mouse and too small under a thumb, and an iPad is both wide
 * and touch-operated — see `useCoarsePointer`.
 */
const ROW_HEIGHT_MOUSE = 40;
const ROW_HEIGHT_TOUCH = 52;
const TOUCH_TARGET = 44;

export interface DomainFilterRowProps {
  row: DomainFilterRowData;
  label: string;
  color: string;
  onlyLabel: string;
  onlyTooltip: string;
  betaTooltip: string;
  /**
   * Finger-sized targets — true on any touch device, iPads included. The row
   * needs no width flag: the sheet/dropdown choice is the PANEL's business,
   * and every size in here follows the pointer instead.
   */
  touch: boolean;
  onToggle: (key: FilterDomainKey) => void;
  onIsolate: (key: FilterDomainKey) => void;
  rowRef: (el: HTMLDivElement | null) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * One checkbox row — `role="checkbox"` per the design's keyboard/a11y
 * requirement (decision, "Bau-Vorgaben"). The row itself is the focusable,
 * checkable widget; "Nur" is a separate button inside it, reachable by Tab
 * but not by the row list's own arrow-key roving (that logic lives in
 * `DomainFilterPanelBody`, which owns focus across all rows).
 */
export function DomainFilterRow({
  row,
  label,
  color,
  onlyLabel,
  onlyTooltip,
  betaTooltip,
  touch,
  onToggle,
  onIsolate,
  rowRef,
  onKeyDown,
}: DomainFilterRowProps): JSX.Element {
  const height = touch ? ROW_HEIGHT_TOUCH : ROW_HEIGHT_MOUSE;

  return (
    <div
      ref={rowRef}
      role="checkbox"
      aria-checked={row.visible}
      aria-label={label}
      tabIndex={-1}
      data-domain-filter-row={row.key}
      onClick={() => onToggle(row.key)}
      onKeyDown={onKeyDown}
      className="flex cursor-pointer items-center outline-none"
      style={{
        minHeight: height,
        padding: "0 10px",
        gap: 10,
        borderRadius: 8,
      }}
    >
      <span
        aria-hidden="true"
        className="flex items-center justify-center"
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          border: `1.5px solid ${row.visible ? color : "var(--ts-border)"}`,
          background: row.visible ? color : "transparent",
          flexShrink: 0,
        }}
      >
        {row.visible && <Icon name="check" size={14} />}
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
          opacity: row.visible ? 1 : 0.4,
        }}
      />
      <Icon name={FILTER_ROW_ICON[row.key]} size={14} />
      <span
        className="flex-1 truncate"
        style={{ color: "var(--ts-text-bright)", opacity: row.visible ? 1 : 0.6, fontSize: 13.5 }}
      >
        {label}
      </span>
      {row.beta && (
        <span
          title={betaTooltip}
          aria-label={betaTooltip}
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--ts-warn)",
            border: "1px solid var(--ts-warn)",
            borderRadius: 999,
            padding: "1px 6px",
            letterSpacing: "0.02em",
          }}
        >
          Beta
        </span>
      )}
      <span
        style={{
          fontFamily: "var(--ts-font-mono)",
          fontSize: 12,
          color: "var(--ts-muted)",
          minWidth: 18,
          textAlign: "right",
        }}
      >
        {/* `null` = this surface cannot know the number (the single-domain
            views do not fetch the tour list). Blank, never 0 — a 0 beside a
            domain that has entries is a wrong number, and this file's whole
            job is to say what is on the map. */}
        {row.count ?? ""}
      </span>
      <button
        type="button"
        title={onlyTooltip}
        onClick={(e) => {
          e.stopPropagation();
          onIsolate(row.key);
        }}
        className="cursor-pointer"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--ts-accent)",
          fontSize: touch ? 13 : 11.5,
          fontWeight: 600,
          padding: touch ? "0 10px" : "2px 6px",
          minHeight: touch ? TOUCH_TARGET : undefined,
          minWidth: touch ? TOUCH_TARGET : undefined,
        }}
      >
        {onlyLabel}
      </button>
    </div>
  );
}
