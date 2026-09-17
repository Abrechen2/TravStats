import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

interface ListRowProps {
  /** The leading mark: a monogram tile, a flag, a domain dot. 34–40px. */
  mark?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** One pill, or a chevron. Not both — a row makes one statement. */
  trailing?: ReactNode;
  /** Unconfirmed. The row's border goes dashed, matching the pill's dash. */
  dashed?: boolean;
  onClick?: () => void;
  href?: string;
  /** Dense lists drop to 36px visually but keep the 44px hit area. */
  dense?: boolean;
}

/**
 * One row, and it looks the same in all four logbooks.
 *
 * 64px, leading mark · title + subtitle · trailing pill or chevron. A dense
 * table may draw it at 36 — the hit area stays 44 either way, which is why the
 * padding rather than the height carries the difference.
 */
export function ListRow({
  mark,
  title,
  subtitle,
  trailing,
  dashed = false,
  onClick,
  href,
  dense = false,
}: ListRowProps): JSX.Element {
  const style: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--ts-space-lg)",
    width: "100%",
    minHeight: dense ? 36 : 64,
    padding: dense ? "0 var(--ts-space-xl)" : "var(--ts-space-md) var(--ts-space-xl)",
    background: "transparent",
    borderBottom: `1px ${dashed ? "dashed" : "solid"} var(--ts-border)`,
    textAlign: "left",
    textDecoration: "none",
    color: "var(--ts-text)",
  };

  const body = (
    <>
      {mark ? <span style={{ flexShrink: 0, display: "flex" }}>{mark}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col" style={{ gap: 2 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "var(--ts-text-bright)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        {subtitle ? (
          <span
            className="t-caption"
            style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
      {trailing ? <span style={{ flexShrink: 0, display: "flex" }}>{trailing}</span> : null}
    </>
  );

  if (href) {
    return (
      <a href={href} className="ts-row" style={style}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="ts-row" style={style}>
        {body}
      </button>
    );
  }
  return (
    <div className="ts-row" style={style}>
      {body}
    </div>
  );
}

export interface TableColumn {
  key: string;
  label: ReactNode;
  /**
   * The narrowest this column can be and still say what it says, in CSS px.
   *
   * A real number, never 0. Until 2026-09-16 columns declared a grid track
   * instead — `200px`, or `minmax(0,1.6fr)` for the one that may shrink — and
   * the flights table on a 1440px screen summed its fixed tracks past the
   * table's width. The one shrinkable column, the ROUTE, got 0px; route and
   * time were drawn on top of each other, and the actions sat outside a frame
   * that clipped them without a trace (CT106 audit, B01).
   */
  min: number;
  /** A share of the spare width. Omitted: the column stays at `min`. */
  grow?: number;
  /**
   * Who steps aside when the table is too narrow for every column. 1 never
   * does; 3 goes before 2. Only above 640px — below it the row layout decides.
   */
  priority?: 1 | 2 | 3;
  align?: "start" | "end";
  /** Codes, identifiers and measurements. Never names or categories. */
  mono?: boolean;
  /**
   * How this cell behaves once the table collapses into a row below 640px:
   * `title` and `subtitle` stack on the left, `trailing` goes right, and
   * anything else is dropped — a phone shows a row, not a table with a
   * horizontal scrollbar.
   */
  onNarrow?: "mark" | "title" | "subtitle" | "trailing" | "hide";
}

function trackOf(column: TableColumn): string {
  return column.grow ? `minmax(${column.min}px, ${column.grow}fr)` : `${column.min}px`;
}

/** Columns plus the gaps and padding between them, as the grid lays them out. */
export function tableMinWidth(
  columns: readonly TableColumn[],
  gap: number,
  padding: number
): number {
  const sum = columns.reduce((total, column) => total + column.min, 0);
  return sum + gap * Math.max(0, columns.length - 1) + padding;
}

/**
 * The columns that step aside so the rest fit `available`.
 *
 * One at a time, not in tiers: priority 3 before priority 2, and within a
 * priority the rightmost first, until the minimums fit. Priority 1 never
 * steps aside. The first version dropped whole tiers, and a 1024px window lost
 * five flight columns at once while the route stretched to 431px — room for
 * two of them left unused.
 *
 * Derived from the columns' own numbers rather than from breakpoints, because
 * the same table sits in a 1150px shell, on a tablet, and behind a column
 * picker that adds or removes any of them. When even the essential columns do
 * not fit, the table scrolls — visibly.
 */
export function pickHidden(
  columns: readonly TableColumn[],
  available: number,
  gap: number,
  padding: number
): Set<string> {
  const hidden = new Set<string>();
  const candidates = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => (column.priority ?? 1) > 1)
    .sort((a, b) => (b.column.priority ?? 1) - (a.column.priority ?? 1) || b.index - a.index);
  for (const { column } of candidates) {
    const shown = columns.filter((c) => !hidden.has(c.key));
    if (tableMinWidth(shown, gap, padding) <= available) break;
    hidden.add(column.key);
  }
  return hidden;
}

/** The keys of the columns that stepped aside, for the rows to follow. */
const HiddenColumns = createContext<ReadonlySet<string>>(new Set());

interface TableProps {
  columns: readonly TableColumn[];
  children: ReactNode;
  /** Names what the table is, for a screen reader. */
  label: string;
  /**
   * Said under the table when columns stepped aside for lack of width. The
   * reader picked those columns; a table that silently drops them reads as a
   * broken picker. Primitives carry no copy, so the page says it.
   */
  hiddenColumnsHint?: (hidden: number) => ReactNode;
  /** Said when even the essential columns need a horizontal scroll. */
  scrollHint?: ReactNode;
}

/**
 * A table that becomes a list.
 *
 * A phone shows rows and a desktop shows the flights table with its columns —
 * but they are the same rows, so this is one DOM with two layouts rather than
 * two components that drift. Below 640px the grid collapses and each cell
 * takes the place its `onNarrow` names; the visual reordering is CSS, and the
 * reading order in the markup is unchanged, so a screen reader is unaffected.
 *
 * Above 640px the table measures itself and lets low-priority columns step
 * aside one at a time until the rest fit (`pickHidden`). If the essential columns alone are
 * wider than the table, it scrolls sideways where the scrollbar can be seen —
 * never `overflow: hidden`, which is how a column disappears without a trace.
 *
 * Grid rather than `<table>`, with the ARIA roles written out. The export drew
 * grid rows and left the roles off, which reads to a screen reader as a stack
 * of unrelated divs.
 */
export function Table({
  columns,
  children,
  label,
  hiddenColumnsHint,
  scrollHint,
}: TableProps): JSX.Element {
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<ReadonlySet<string>>(new Set());
  const [scrolls, setScrolls] = useState(false);

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table || typeof ResizeObserver === "undefined") return;
    const measure = (): void => {
      const head = table.firstElementChild;
      if (!(head instanceof HTMLElement)) return;
      const style = getComputedStyle(head);
      const gap = parseFloat(style.columnGap) || 0;
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      // Below 640px the CSS draws rows, not columns: nothing steps aside and
      // nothing scrolls, so neither hint may be said (CT106 design-6 M01).
      const rowLayout = window.matchMedia?.("(max-width: 639px)").matches ?? false;
      const next = rowLayout
        ? new Set<string>()
        : pickHidden(columns, table.clientWidth, gap, padding);
      const shown = columns.filter((column) => !next.has(column.key));
      // A new Set every measure would re-render every row on every resize tick.
      setHiddenKeys((current) =>
        current.size === next.size && [...next].every((key) => current.has(key)) ? current : next
      );
      setScrolls(!rowLayout && tableMinWidth(shown, gap, padding) > table.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    return (): void => observer.disconnect();
  }, [columns]);

  const shown = columns.filter((column) => !hiddenKeys.has(column.key));
  const hidden = columns.length - shown.length;

  return (
    <div
      className="ts-table-frame"
      style={{
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
        overflow: "hidden",
      }}
    >
      <div
        ref={tableRef}
        role="table"
        aria-label={label}
        className="ts-table"
        data-scrolls={scrolls ? "yes" : "no"}
        style={
          {
            "--ts-table-template": shown.map(trackOf).join(" "),
            "--ts-table-columns-min": `${shown.reduce((sum, column) => sum + column.min, 0)}px`,
            "--ts-table-column-count": shown.length,
          } as CSSProperties
        }
      >
        <div role="row" className="ts-table-head">
          {columns.map((column) => (
            <span
              key={column.key}
              role="columnheader"
              className="t-label-mono"
              data-narrow={column.onNarrow ?? "hide"}
              data-stepped-aside={hiddenKeys.has(column.key) ? "yes" : undefined}
              style={{ textAlign: column.align === "end" ? "right" : "left", minWidth: 0 }}
            >
              {column.label}
            </span>
          ))}
        </div>
        <HiddenColumns.Provider value={hiddenKeys}>{children}</HiddenColumns.Provider>
      </div>
      {hidden > 0 && hiddenColumnsHint ? (
        <p className="ts-table-hint t-caption">{hiddenColumnsHint(hidden)}</p>
      ) : null}
      {scrolls && scrollHint ? <p className="ts-table-hint t-caption">{scrollHint}</p> : null}
    </div>
  );
}

interface TableRowProps {
  columns: readonly TableColumn[];
  /** One node per column, in column order. */
  cells: readonly ReactNode[];
  dashed?: boolean;
  onClick?: () => void;
  dense?: boolean;
  /**
   * A subtitle for the narrow layout only, when no single column can be it.
   *
   * The flights list is the case this exists for: a phone needs "date ·
   * flight number · duration" on one line, and the desktop says those three
   * things in three separate columns — the time column alone is a two-line
   * ab/an block that cannot shrink into a 12px subtitle. Supplying it here
   * keeps the composition in the row rather than making the time cell aware
   * of how wide the window is.
   *
   * It is `display: none` above 640px and the columns it summarises are
   * `display: none` below it, so a screen reader is never read both.
   */
  narrowSubtitle?: ReactNode;
}

/**
 * A table row.
 *
 * The whole row is one tab stop and the actions inside it are the next ones —
 * a clickable row that swallows its own action buttons was measured as broken
 * in August, and nesting an interactive element inside a `<button>` is what
 * caused it. Hence a `div` with a row role and a click handler, not a button.
 */
export function TableRow({
  columns,
  cells,
  dashed = false,
  onClick,
  dense = false,
  narrowSubtitle,
}: TableRowProps): JSX.Element {
  const hiddenKeys = useContext(HiddenColumns);
  return (
    <div
      role="row"
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className="ts-table-row"
      data-clickable={onClick ? "yes" : "no"}
      style={{
        minHeight: dense ? 36 : 64,
        borderTop: `1px ${dashed ? "dashed" : "solid"} var(--ts-border)`,
      }}
    >
      {cells.map((cell, index) => {
        const column = columns[index];
        return (
          <span
            key={column?.key ?? index}
            role="cell"
            data-narrow={column?.onNarrow ?? "hide"}
            data-stepped-aside={column && hiddenKeys.has(column.key) ? "yes" : undefined}
            style={{
              fontFamily: column?.mono ? "var(--ts-font-mono)" : undefined,
              fontVariantNumeric: column?.mono ? "tabular-nums" : undefined,
              textAlign: column?.align === "end" ? "right" : "left",
              minWidth: 0,
            }}
          >
            {cell}
          </span>
        );
      })}
      {narrowSubtitle === undefined ? null : (
        <span role="cell" data-narrow="subtitle" data-narrow-only="yes" style={{ minWidth: 0 }}>
          {narrowSubtitle}
        </span>
      )}
    </div>
  );
}
