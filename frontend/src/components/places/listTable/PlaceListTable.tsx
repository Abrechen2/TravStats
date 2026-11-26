import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { logger } from "../../../lib/logger";
import { getListMembers } from "../../../lib/api/placeLists";
import { SortableHeader } from "../../table/SortableHeader";
import TablePagination from "../../table/TablePagination";
import { useServerPagination } from "../../table/useServerPagination";
import type { ListMembersPage, ListSortKey } from "../../../types/placeList";
import PlaceListTableRow from "./PlaceListTableRow";
import { firstOrderOf, useListSort } from "./useListSort";

const SERVER_MAX_PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 250;
/** The sort select's choices, in the owner's order. */
const SELECT_KEYS: ListSortKey[] = [
  "lastVisit",
  "name",
  "country",
  "visitCount",
  "firstVisit",
  "addedAt",
  "custom",
];

/**
 * A place list as a table (owner 2026-11-26): sorted, searched and paged on the server. The sort
 * lives in the URL and is remembered per list. Up/down only in "Eigene Reihenfolge" without a
 * search, where the rows on screen are the list's own order.
 */
export default function PlaceListTable({
  listId,
  refreshKey,
  iconOf,
  onRemove,
  onMove,
}: {
  listId: string;
  /** A new value when the membership changed elsewhere on the page (the page's list object). */
  refreshKey: unknown;
  iconOf: (category: string) => string;
  onRemove: (placeId: string) => void;
  /** Moves an entry one step in the list's own order. */
  onMove: (placeId: string, delta: -1 | 1) => Promise<void>;
}): JSX.Element {
  const { t, i18n } = useTranslation(["places", "common"]);
  const lang = i18n?.language?.startsWith("en") ? "en" : "de";
  const { sort, order, setSort } = useListSort(listId);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<ListMembersPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const pager = useServerPagination(
    data?.total ?? 0,
    `place-list:${listId}`,
    `${sort}:${order}:${q}`,
    "page"
  );
  const pageSize = Math.min(pager.pageSize, SERVER_MAX_PAGE_SIZE);

  useEffect(() => {
    const id = setTimeout(() => setQ(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getListMembers(listId, { sort, order, page: pager.page, pageSize, q }));
      setFailed(false);
    } catch (err: unknown) {
      logger.error({ err }, "PlaceListTable: members not loaded");
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [listId, sort, order, pager.page, pageSize, q]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const moveAndReload = async (placeId: string, delta: -1 | 1): Promise<void> => {
    // The page stores the reordered list, which is a new `refreshKey`: the table reads again.
    await onMove(placeId, delta);
  };

  const header = (key: ListSortKey, label: string) => (
    <SortableHeader
      column={key}
      sortBy={sort}
      sortOrder={order}
      onSort={(k) => setSort(k, k === sort ? (order === "asc" ? "desc" : "asc") : firstOrderOf(k))}
      ariaLabel={t("places:lists.table.sortBy", { col: label })}
    >
      {label}
    </SortableHeader>
  );

  const rows = data?.rows ?? [];
  const columns = data?.columns ?? [];
  const showDistance = data?.hasHome ?? false;
  const reorderable = sort === "custom" && order === "asc" && q === "";
  const th = "px-3 py-2 text-left text-xs font-medium";

  return (
    <section aria-label={t("places:lists.table.label")} data-testid="place-list-table">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("places:lists.table.search")}
          aria-label={t("places:lists.table.search")}
          className="min-w-0 flex-1 rounded-lg px-3 py-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
          style={{ border: "1px solid var(--color-border)", background: "var(--bg-surface)" }}
        />
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {t("places:lists.table.sortLabel")}
          <select
            value={sort}
            onChange={(e) => {
              const k = e.target.value as ListSortKey;
              setSort(k, firstOrderOf(k));
            }}
            className="rounded-lg px-2 py-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
            style={{ border: "1px solid var(--color-border)", background: "var(--bg-surface)" }}
            data-testid="place-list-sort"
          >
            {SELECT_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(`places:lists.table.sort.${k}`)}
              </option>
            ))}
            {sort === "distance" && (
              <option value="distance">{t("places:lists.table.col.distance")}</option>
            )}
          </select>
        </label>
      </div>

      {failed && (
        <p role="alert" className="mb-3 text-sm" style={{ color: "var(--danger)" }}>
          {t("places:lists.table.loadFailed")}{" "}
          <button type="button" className="underline" onClick={() => void load()}>
            {t("common:buttons.retry")}
          </button>
        </p>
      )}

      {!failed && !loading && rows.length === 0 ? (
        <p className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          {q ? t("places:lists.table.noMatch") : t("places:lists.listEmpty")}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead style={{ color: "var(--text-muted)" }}>
                <tr>
                  <th className={th}>{header("name", t("places:lists.table.col.name"))}</th>
                  <th className={th}>{header("country", t("places:lists.table.col.country"))}</th>
                  <th className={th}>{t("places:lists.table.col.city")}</th>
                  <th className={th}>{header("visitCount", t("places:lists.table.col.visits"))}</th>
                  <th className={th}>{header("lastVisit", t("places:lists.table.col.last"))}</th>
                  <th className={th}>{header("firstVisit", t("places:lists.table.col.first"))}</th>
                  <th className={th}>{t("places:lists.table.col.source")}</th>
                  {showDistance && (
                    <th className={th}>
                      {header("distance", t("places:lists.table.col.distance"))}
                    </th>
                  )}
                  {columns.map((c) => (
                    <th key={c.key} className={th}>
                      {c.label[lang]}
                    </th>
                  ))}
                  <th className={th}>
                    <span className="sr-only">{t("places:lists.table.col.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <PlaceListTableRow
                    key={row.entryId}
                    row={row}
                    columns={columns}
                    showDistance={showDistance}
                    icon={iconOf(row.category)}
                    expanded={expanded.has(row.entryId)}
                    onToggle={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.entryId)) next.delete(row.entryId);
                        else next.add(row.entryId);
                        return next;
                      })
                    }
                    onRemove={() => onRemove(row.placeId)}
                    move={
                      reorderable
                        ? {
                            up:
                              pager.offset + i > 0
                                ? () => void moveAndReload(row.placeId, -1)
                                : null,
                            down:
                              pager.offset + i < (data?.total ?? 0) - 1
                                ? () => void moveAndReload(row.placeId, 1)
                                : null,
                          }
                        : null
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          {(data?.total ?? 0) > pageSize && (
            <TablePagination
              page={pager.page}
              pageCount={pager.pageCount}
              pageSize={pageSize}
              total={pager.total}
              setPage={pager.setPage}
              setPageSize={pager.setPageSize}
              allowAll={false}
              placement="bottom"
            />
          )}
        </>
      )}
    </section>
  );
}
