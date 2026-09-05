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
  /** Grid track. `minmax(0,1fr)` for the one column that may shrink. */
  width: string;
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

interface TableProps {
  columns: readonly TableColumn[];
  children: ReactNode;
  /** Names what the table is, for a screen reader. */
  label: string;
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
 * Grid rather than `<table>`, with the ARIA roles written out. The export drew
 * grid rows and left the roles off, which reads to a screen reader as a stack
 * of unrelated divs.
 */
export function Table({ columns, children, label }: TableProps): JSX.Element {
  const template = columns.map((c) => c.width).join(" ");
  return (
    <div
      role="table"
      aria-label={label}
      className="ts-table"
      style={
        {
          "--ts-table-template": template,
          background: "var(--ts-surface)",
          border: "1px solid var(--ts-border)",
          borderRadius: "var(--ts-radius-card)",
          overflow: "hidden",
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
            style={{ textAlign: column.align === "end" ? "right" : "left" }}
          >
            {column.label}
          </span>
        ))}
      </div>
      {children}
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
}: TableRowProps): JSX.Element {
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
    </div>
  );
}
