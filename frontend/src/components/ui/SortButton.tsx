import { Icon } from "./Icon";
import type { JSX, ReactNode } from "react";

interface SortButtonProps {
  /** This column is the one the list is sorted by. */
  active: boolean;
  order: "asc" | "desc";
  onSort: () => void;
  /** "Nach Name sortieren": what a click does, for a screen reader. */
  ariaLabel: string;
  children: ReactNode;
}

/**
 * The sort button inside a column header. Ascending points UP (A→Z and
 * early→late read upward); the active column is accent-coloured and
 * underlined, and the arrow's room is reserved on the others so a header does
 * not jump when the sort moves. `Table` draws it for a column that declares
 * `sort`; a hand-built `<th>` uses it directly.
 */
export function SortButton({
  active,
  order,
  onSort,
  ariaLabel,
  children,
}: SortButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSort}
      aria-label={ariaLabel}
      className="flex items-center gap-1 text-left uppercase tracking-wider pointer-coarse:min-h-(--ts-size-touch-min)"
      style={
        active
          ? { color: "var(--ts-accent)", borderBottom: "2px solid var(--ts-accent)" }
          : undefined
      }
    >
      {children}
      <span className={active ? "" : "opacity-0"} aria-hidden>
        <Icon
          name={active && order === "desc" ? "chevron-down" : "chevron-up"}
          size={14}
          label={undefined}
        />
      </span>
    </button>
  );
}

/** The `aria-sort` value a header cell carries. */
export function ariaSortOf(
  active: boolean,
  order: "asc" | "desc"
): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return order === "asc" ? "ascending" : "descending";
}
