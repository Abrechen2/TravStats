import type { JSX, ReactNode } from "react";

interface SortableHeaderProps<K extends string> {
  column: K;
  sortBy: K;
  sortOrder: "asc" | "desc";
  onSort: (column: K) => void;
  /** aria-label, e.g. t("list.sortBy", { col }). */
  ariaLabel: string;
  children: ReactNode;
}

/**
 * Header-cell sort button shared by the domain list tables. Uses the cruises
 * page's idiom (the better of the two existing ones): a reserved-width
 * indicator so headers do not jump when the sort moves, and an accent color
 * on the active column.
 */
export function SortableHeader<K extends string>({
  column,
  sortBy,
  sortOrder,
  onSort,
  ariaLabel,
  children,
}: SortableHeaderProps<K>): JSX.Element {
  const active = sortBy === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      aria-label={ariaLabel}
      className="flex items-center gap-1 text-left uppercase tracking-wider"
      style={active ? { color: "var(--accent)" } : undefined}
    >
      {children}
      <span className={active ? "" : "opacity-0"} aria-hidden>
        {active ? (sortOrder === "asc" ? "▲" : "▼") : "▲"}
      </span>
    </button>
  );
}
