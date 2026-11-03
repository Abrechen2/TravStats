import Modal from "../Modal";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { JSX, ReactNode } from "react";
import { Table, TableRow, type TableColumn } from "../ui/Table";
import { useTableHints } from "../ui/useTableHints";
import { ColumnPicker } from "../table/ColumnPicker";
import { SortableHeader } from "../table/SortableHeader";
import TablePagination from "../table/TablePagination";
import { RowActionButton, RowActions } from "../table/RowActionButton";
import { useColumnPrefs } from "../table/useColumnPrefs";
import { useSortPrefs } from "../table/useSortPrefs";
import { usePagination } from "../table/usePagination";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";
import {
  listImportBatches,
  listImportBatchItems,
  revertImportBatch,
} from "../../lib/api/importBatches";
import type { ImportBatchSummary, ImportBatchItems } from "../../lib/api/importBatches";
import { DOMAINS } from "../../shared/domains";
import { useDomainColors } from "../../hooks/useDomainColors";
import { formatDate } from "../../lib/displayFormat";

interface Props {
  /** Runs after a successful revert so a surrounding page (list + stats) can refresh too. */
  onReverted?: () => void | Promise<void>;
  /** Bump this whenever a new import lands elsewhere on the page — triggers a re-fetch here. */
  reloadKey?: unknown;
}

/**
 * The import log — every bulk import run, newest first, each revertible as a
 * unit. It lives in the CENTRAL import hub (Settings → Import) rather than on
 * a domain page, which is the same rule 2.5.0 established for the importers
 * themselves: one place to import, one place to see what was imported.
 *
 * It used to cover stays alone, because they were the only domain that
 * recorded its imports; a flight logbook could be imported and left no trace
 * at all, so the log read "nothing imported yet" while 160 flights had just
 * landed. Every domain writes a batch now, and each entry says which area it
 * belongs to.
 *
 * A revert deletes only what that batch created — a batch-created lodging that
 * still has foreign stays (hand-added, or attached by a later batch) survives,
 * detached (`detachedLodgings`). The confirm dialog and the result toast both
 * exist to make that distinction visible, never to hide it.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

type LogColumnId = "area" | "source" | "date" | "contents" | "actions";
const COLUMN_IDS: readonly LogColumnId[] = ["area", "source", "date", "contents", "actions"];
const ALWAYS_VISIBLE: readonly LogColumnId[] = ["source", "actions"];
const SORTABLE: readonly LogColumnId[] = ["area", "source", "date", "contents"];
const COLUMN_LAYOUT: Record<
  LogColumnId,
  Pick<TableColumn, "min" | "grow" | "priority" | "onNarrow" | "align">
> = {
  area: { min: 120, priority: 2, onNarrow: "mark" },
  source: { min: 200, grow: 2, onNarrow: "title" },
  date: { min: 110, priority: 2 },
  contents: { min: 200, grow: 1, priority: 3, onNarrow: "subtitle" },
  actions: { min: 150, align: "end", onNarrow: "trailing" },
};

/**
 * Client-side sort over the runs already loaded. Ties keep the server's
 * newest-first order (Array.prototype.sort is stable).
 */
function sortBatches(
  batches: readonly ImportBatchSummary[],
  by: LogColumnId,
  order: "asc" | "desc",
  t: Translate
): ImportBatchSummary[] {
  const key = (b: ImportBatchSummary): string | number => {
    switch (by) {
      case "area":
        return t(`common:${DOMAINS[b.domain].i18nKey}`);
      case "source":
        return `${t(`lodging:import.batches.source.${b.source}`)} ${b.fileName ?? ""}`;
      case "contents":
        return revertCount(b);
      default:
        return Date.parse(b.createdAt);
    }
  };
  const dir = order === "asc" ? 1 : -1;
  return [...batches].sort((x, y) => {
    const a = key(x);
    const b = key(y);
    if (typeof a === "number" && typeof b === "number") return (a - b) * dir;
    return String(a).localeCompare(String(b)) * dir;
  });
}

/**
 * What a batch produced, in the words of its own area. A stay import made
 * houses AND nights; a flight import made flights. One shared phrasing would
 * have to say "rows", which tells the user nothing about what they would get
 * back by reverting it.
 */
function describeCounts(batch: ImportBatchSummary, t: Translate): string {
  const { lodgings, stays, flights, cruises, places, stops = 0 } = batch.counts;
  if (batch.domain === "flight") return t("settings:import.log.counts.flights", { count: flights });
  if (batch.domain === "cruise") return t("settings:import.log.counts.cruises", { count: cruises });
  if (batch.domain === "poi") {
    const placesText = t("settings:import.log.counts.places", { count: places });
    // A Takeout import can write trip stops instead of places.
    return stops > 0
      ? `${placesText} · ${t("settings:import.log.counts.stops", { count: stops })}`
      : placesText;
  }
  return t("lodging:import.batches.created", {
    hotels: t("lodging:units.hotels", { count: lodgings }),
    stays: t("lodging:units.stays", { count: stays }),
  });
}

/** How many rows the revert of this batch would delete. */
function revertCount(batch: ImportBatchSummary): number {
  const { lodgings, stays, flights, cruises, places, stops = 0 } = batch.counts;
  if (batch.domain === "flight") return flights;
  if (batch.domain === "cruise") return cruises;
  if (batch.domain === "poi") return places + stops;
  return lodgings + stays;
}

/**
 * What the dialog promises, per domain — because the domains do different
 * things and only one of them did what the dialog said.
 *
 * The lodging revert really is careful: `revertLodgingImportBatch` keeps a
 * house that other stays still hang from, and detaches it instead of deleting
 * it. Its sentence says so, and it is true.
 *
 * The flight, cruise and POI arms are a `deleteMany` scoped to the batch
 * (`importBatchService.ts:341`, and the POI arm above it). Nothing is checked
 * and nothing is kept: a flight the user corrected by hand after the import
 * goes, and the documents filed against it cascade with it. Showing all four
 * the lodging arm's promise was a statement about the code that was false for
 * three of them (data-integrity audit 2026-09-19, finding 5).
 *
 * The honest minimum is to say which of the two it is. Making the other three
 * behave like lodging is a different, larger change — and one the user should
 * be asked about, not surprised by.
 */
function confirmKeys(domain: ImportBatchSummary["domain"]): { title: string; message: string } {
  return domain === "lodging"
    ? {
        title: "lodging:import.batches.confirmTitle",
        message: "lodging:import.batches.confirmMessage",
      }
    : {
        title: "settings:import.log.confirm.title",
        message: "settings:import.log.confirm.message",
      };
}

export function ImportLogSection({ onReverted, reloadKey }: Props): JSX.Element {
  const { t } = useTranslation(["lodging", "settings", "common"]);
  const { colorOf } = useDomainColors();
  const addToast = useToastStore((s) => s.addToast);

  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  /**
   * Which entries are open, and what their rows are. Loaded on FIRST open and
   * kept: a log with ten runs would otherwise fire ten requests for lists
   * nobody looked at, and re-fetch each one on every collapse.
   */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [itemsByBatch, setItemsByBatch] = useState<Record<string, ImportBatchItems>>({});
  const [itemsLoading, setItemsLoading] = useState<string | null>(null);
  const [itemsError, setItemsError] = useState<Record<string, boolean>>({});

  const toggleItems = useCallback(
    async (batchId: string): Promise<void> => {
      if (expandedId === batchId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(batchId);
      if (itemsByBatch[batchId] !== undefined) return;
      setItemsLoading(batchId);
      setItemsError((prev) => ({ ...prev, [batchId]: false }));
      try {
        const loaded = await listImportBatchItems(batchId);
        setItemsByBatch((prev) => ({ ...prev, [batchId]: loaded }));
      } catch (err) {
        // An empty list and a failed request look identical on screen unless
        // one of them says so.
        logger.error("ImportLogSection: failed to load batch items", err);
        setItemsError((prev) => ({ ...prev, [batchId]: true }));
      } finally {
        setItemsLoading(null);
      }
    },
    [expandedId, itemsByBatch]
  );
  const [reverting, setReverting] = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await listImportBatches();
      setBatches(data);
    } catch (err: unknown) {
      logger.error("ImportLogSection: failed to load import batches", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // `reloadKey` is an opaque re-fetch trigger driven by the parent page's
    // own reload cycle (a new import landing elsewhere on the page) — it is
    // intentionally not otherwise read here.
  }, [load, reloadKey]);

  const handleRevert = useCallback(
    async (batchId: string): Promise<void> => {
      setReverting(true);
      try {
        const result = await revertImportBatch(batchId);
        // A stay import can leave a hotel standing when other stays still hang
        // from it — saying so is the difference between "8 removed" and the
        // user wondering why a hotel is still there.
        addToast(
          "success",
          result.detached
            ? t("settings:import.log.revertedWithKept", {
                count: result.deleted,
                kept: result.detached,
              })
            : t("settings:import.log.reverted", { count: result.deleted })
        );
        setConfirmingId(null);
        await load();
        await onReverted?.();
      } catch (err: unknown) {
        logger.error("ImportLogSection: revert failed", err);
        addToast("error", t("lodging:import.batches.revertError"));
      } finally {
        setReverting(false);
      }
    },
    [addToast, load, onReverted, t]
  );

  const columnPrefs = useColumnPrefs("import-log", ALWAYS_VISIBLE);
  const tableHints = useTableHints();
  const { sortBy, sortOrder, setSort } = useSortPrefs<LogColumnId>(
    "import-log",
    "date",
    "desc",
    SORTABLE
  );
  const handleSort = useCallback(
    (column: LogColumnId): void => {
      if (sortBy === column) setSort(column, sortOrder === "asc" ? "desc" : "asc");
      else setSort(column, column === "date" || column === "contents" ? "desc" : "asc");
    },
    [sortBy, sortOrder, setSort]
  );
  const sorted = useMemo(
    () => sortBatches(batches, sortBy, sortOrder, t),
    [batches, sortBy, sortOrder, t]
  );
  const pagination = usePagination(sorted, "import-log");

  const columns = useMemo<TableColumn[]>(
    () =>
      COLUMN_IDS.filter((id) => columnPrefs.isVisible(id)).map((id) => {
        const layout = COLUMN_LAYOUT[id];
        const label = t(`settings:import.log.columns.${id}`);
        return {
          key: id,
          ...layout,
          label: SORTABLE.includes(id) ? (
            <SortableHeader
              column={id}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSort={handleSort}
              ariaLabel={t("settings:import.log.sortBy", { col: label })}
            >
              {label}
            </SortableHeader>
          ) : (
            label
          ),
        };
      }),
    [columnPrefs, t, sortBy, sortOrder, handleSort]
  );
  const pickable = useMemo(
    () =>
      COLUMN_IDS.map((id) => ({
        id,
        label: t(`settings:import.log.columns.${id}`),
        always: ALWAYS_VISIBLE.includes(id),
      })),
    [t]
  );

  const renderCell = (id: LogColumnId, batch: ImportBatchSummary): ReactNode => {
    switch (id) {
      case "area":
        // Which area this run landed in. Never left implicit: an unlabelled
        // log reads as if it covered everything.
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: colorOf(batch.domain) }}
            />
            {t(`common:${DOMAINS[batch.domain].i18nKey}`)}
          </span>
        );
      case "source":
        return (
          <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            <span>{t(`lodging:import.batches.source.${batch.source}`)}</span>
            {batch.fileName && <span> · {batch.fileName}</span>}
          </span>
        );
      case "date":
        return <span className="text-sm">{formatDate(batch.createdAt)}</span>;
      case "contents":
        return <span className="text-sm">{describeCounts(batch, t)}</span>;
      case "actions":
        return (
          <RowActions>
            <button
              type="button"
              data-testid={`batch-items-toggle-${batch.id}`}
              aria-expanded={expandedId === batch.id}
              aria-controls={`batch-items-${batch.id}`}
              onClick={() => void toggleItems(batch.id)}
              className="whitespace-nowrap rounded-md border border-[var(--color-border)] px-2 py-1 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-base)] pointer-coarse:min-h-(--ts-size-touch-min)"
            >
              <span aria-hidden="true">{expandedId === batch.id ? "▾" : "▸"}</span>{" "}
              {t("settings:import.log.items.toggle")}
            </button>
            <RowActionButton
              icon="delete"
              testId={`batch-revert-${batch.id}`}
              label={t("lodging:import.batches.revert")}
              onClick={() => setConfirmingId(batch.id)}
            />
          </RowActions>
        );
    }
  };

  /** The rows one run created, under its table row — loading, failure and empty each say so. */
  const renderItems = (batchId: string): JSX.Element => {
    const loaded = itemsByBatch[batchId];
    return (
      <div id={`batch-items-${batchId}`} className="border-t border-[var(--ts-border)] px-4 py-2">
        {itemsLoading === batchId ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("settings:import.log.items.loading")}
          </p>
        ) : itemsError[batchId] ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {t("settings:import.log.items.error")}
          </p>
        ) : (loaded?.items.length ?? 0) === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("settings:import.log.items.empty")}
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {loaded!.items.map((item) => (
                <li
                  key={`${item.kind}-${item.id}`}
                  className="flex items-baseline justify-between gap-3 text-xs"
                >
                  <span style={{ color: "var(--text-primary)" }}>{item.label}</span>
                  <span style={{ color: "var(--text-muted)" }}>
                    {[item.detail, item.date ? formatDate(item.date) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
            {loaded!.truncated && (
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {t("settings:import.log.items.truncated", {
                  shown: loaded!.items.length,
                  total: loaded!.total,
                })}
              </p>
            )}
          </>
        )}
      </div>
    );
  };

  const confirmingBatch = batches.find((b) => b.id === confirmingId) ?? null;

  return (
    <div
      className="mt-6 rounded-lg p-4"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
    >
      {/* No heading of its own: the button that opens this panel carries the
          title, and repeating it put "Import-Logbuch" on screen twice, one
          line apart. The scope hint stays — it says what the log does and does
          not cover, which the title alone never did. */}
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {t("settings:import.log.scopeHint")}
      </p>

      {loading ? (
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {t("lodging:import.batches.loading")}
        </p>
      ) : loadError ? (
        <div
          role="alert"
          className="mt-2 rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {t("lodging:import.batches.loadError")}
        </div>
      ) : batches.length === 0 ? (
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {t("lodging:import.batches.empty")}
        </p>
      ) : (
        <>
          <div className="mt-3 flex justify-end">
            <ColumnPicker columns={pickable} prefs={columnPrefs} />
          </div>
          <div className="mt-2">
            <TablePagination {...pagination} placement="top" />
            <Table columns={columns} label={t("settings:import.log.title")} {...tableHints}>
              {pagination.paged.map((batch) => (
                <Fragment key={batch.id}>
                  <TableRow
                    testId={`batch-row-${batch.id}`}
                    columns={columns}
                    cells={columns.map((column) => renderCell(column.key as LogColumnId, batch))}
                  />
                  {expandedId === batch.id && renderItems(batch.id)}
                </Fragment>
              ))}
            </Table>
            <TablePagination {...pagination} />
            <p className="mt-2 px-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {t("settings:import.log.sortedBy", {
                col: t(`settings:import.log.columns.${sortBy}`),
                dir: t(sortOrder === "asc" ? "common:sort.ascending" : "common:sort.descending"),
              })}
            </p>
          </div>
        </>
      )}

      <Modal
        open={confirmingBatch !== undefined && confirmingBatch !== null}
        onClose={() => setConfirmingId(null)}
        busy={reverting}
        title={t(confirmKeys(confirmingBatch?.domain ?? "lodging").title)}
        maxWidth={448}
        closeLabel={t("common:buttons.close")}
        footer={
          <>
            <button
              type="button"
              data-testid="batch-revert-cancel"
              onClick={() => setConfirmingId(null)}
              disabled={reverting}
              className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
            >
              {t("common:buttons.cancel")}
            </button>
            <button
              type="button"
              data-testid="batch-revert-confirm"
              onClick={() => confirmingBatch && void handleRevert(confirmingBatch.id)}
              disabled={reverting}
              className="rounded-md bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {t("lodging:import.batches.revert")}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-muted)]">
          {confirmingBatch &&
            t(confirmKeys(confirmingBatch.domain).message, {
              count: revertCount(confirmingBatch),
            })}
        </p>
      </Modal>
    </div>
  );
}
