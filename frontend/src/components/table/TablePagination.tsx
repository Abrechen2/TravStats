import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

/**
 * The control row under a paginated table: range text, first/prev/next/last,
 * and the page-size choice. Pure and stateless — `usePagination` owns the
 * numbers, this only renders them and calls back into its setters, so all
 * four logbook lists share one control instead of four slightly different
 * ones.
 */
export interface TablePaginationProps {
  page: number;
  pageCount: number;
  pageSize: number | "all";
  total: number;
  setPage: (page: number) => void;
  setPageSize: (size: number | "all") => void;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

const BUTTON_CLASS =
  "rounded-md border border-[var(--color-border)] px-2 py-1 text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40";

/** The "x–y von z" numbers, worked out once so the component and its tests
 *  agree on the same arithmetic. `total === 0` reads as 0-0, never 1-0 —
 *  an empty page still has to say it has nothing, not "row one of zero". */
export function paginationRange(
  page: number,
  pageSize: number | "all",
  total: number
): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  if (pageSize === "all") return { from: 1, to: total };
  return { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total) };
}

export default function TablePagination({
  page,
  pageCount,
  pageSize,
  total,
  setPage,
  setPageSize,
}: TablePaginationProps): JSX.Element {
  const { t } = useTranslation(["common"]);
  const { from, to } = paginationRange(page, pageSize, total);
  const atFirst = page <= 1;
  const atLast = page >= pageCount;

  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-[var(--text-muted)]">
      <span>{t("common:table.pagination.range", { from, to, total })}</span>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("common:table.pagination.first")}
            onClick={() => setPage(1)}
            disabled={atFirst}
            className={BUTTON_CLASS}
          >
            «
          </button>
          <button
            type="button"
            aria-label={t("common:table.pagination.previous")}
            onClick={() => setPage(page - 1)}
            disabled={atFirst}
            className={BUTTON_CLASS}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={t("common:table.pagination.next")}
            onClick={() => setPage(page + 1)}
            disabled={atLast}
            className={BUTTON_CLASS}
          >
            ›
          </button>
          <button
            type="button"
            aria-label={t("common:table.pagination.last")}
            onClick={() => setPage(pageCount)}
            disabled={atLast}
            className={BUTTON_CLASS}
          >
            »
          </button>
        </div>
        <label className="flex items-center gap-2">
          <span>{t("common:table.pagination.pageSize")}</span>
          <select
            value={pageSize}
            onChange={(e): void =>
              setPageSize(e.target.value === "all" ? "all" : Number(e.target.value))
            }
            className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-2 py-1 text-[var(--text-primary)]"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
            <option value="all">{t("common:table.pagination.all")}</option>
          </select>
        </label>
      </div>
    </div>
  );
}
