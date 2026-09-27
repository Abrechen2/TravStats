import type { JSX } from "react";
import { Icon, type IconName } from "../../ui/Icon";
import type { DomainFilterRow as DomainFilterRowData } from "../../../hooks/useDashboardDomainFilter";
import type { FilterDomainKey } from "../../../shared/dashboardDomainFilter";

/** Same glyphs `DomainTabStrip` uses for these six — one visual vocabulary. */
export const FILTER_ROW_ICON: Record<FilterDomainKey, IconName> = {
  flight: "plane",
  cruise: "ship",
  lodging: "bed",
  poi: "map-pin",
  tour: "route",
  roadtrip: "caravan",
};

const ROW_HEIGHT_DESKTOP = 40;
const ROW_HEIGHT_PHONE = 52;
const TOUCH_TARGET_PHONE = 44;

export interface DomainFilterRowProps {
  row: DomainFilterRowData;
  label: string;
  color: string;
  onlyLabel: string;
  onlyTooltip: string;
  betaTooltip: string;
  phone: boolean;
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
  phone,
  onToggle,
  onIsolate,
  rowRef,
  onKeyDown,
}: DomainFilterRowProps): JSX.Element {
  const height = phone ? ROW_HEIGHT_PHONE : ROW_HEIGHT_DESKTOP;

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
        {row.count}
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
          fontSize: phone ? 13 : 11.5,
          fontWeight: 600,
          padding: phone ? "0 10px" : "2px 6px",
          minHeight: phone ? TOUCH_TARGET_PHONE : undefined,
          minWidth: phone ? TOUCH_TARGET_PHONE : undefined,
        }}
      >
        {onlyLabel}
      </button>
    </div>
  );
}
