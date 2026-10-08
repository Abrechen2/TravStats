import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { SkeletonTable } from "../SkeletonLoader";
import { Table, TableRow, type TableColumn } from "../ui/Table";
import ListEmptyState from "../table/ListEmptyState";
import ListLoadFailed, { loadFailureLog } from "../table/ListLoadFailed";
import TablePagination from "../table/TablePagination";
import { RowActionButton, RowActions } from "../table/RowActionButton";
import { useServerPagination } from "../table/useServerPagination";
import { useTableHints } from "../ui/useTableHints";
import { FilterField } from "../table/ListFilterBar";
import { FieldError } from "../form";
import { StayEditor } from "./StayEditor";
import { StayDeleteConfirm } from "./StayDeleteConfirm";
import { StayStatusPill } from "./StayStatusPill";
import { lodgingLifecycleStatus } from "./lodgingLifecycle";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { deleteStay, listStayPage } from "../../lib/api/lodging";
import { tripsApi } from "../../lib/api";
import { logger } from "../../lib/logger";
import { formatStayPeriod, hasUnknownLength, stayNights } from "../../lib/lodgingDateDisplay";
import type { LodgingStayListItem } from "../../types/lodging";
import type { Trip } from "../../types";

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] pointer-coarse:min-h-(--ts-size-touch-min)";

/** Period first, then the house, then the rest. The period is the row's identity here. */
const COLUMNS = [
  { key: "period", min: 150, grow: 1, onNarrow: "title" },
  { key: "house", min: 190, grow: 2, onNarrow: "subtitle" },
  { key: "trip", min: 120, grow: 1, priority: 2 },
  { key: "status", min: 110, onNarrow: "trailing" },
  { key: "actions", min: 80, align: "end" },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];

interface LodgingStaysViewProps {
  /** Opens the page's own "add a house" dialog - a stay needs a house first. */
  onAddHouse: () => void;
  /**
   * Called after a stay was saved or deleted here. The house list's rows carry
   * the stay counts, nights, last stay and spend, so it is stale the moment a
   * stay changes - the page reloads it (forgejo#226).
   */
  onChanged?: () => void;
}

/**
 * The chronological view across houses (forgejo#226): every stay of the
 * account, newest check-in first, as a server-paged logbook. A house with three
 * stays is three rows here - told apart by their period, room and booking
 * reference - and each leads to its house; the row itself opens the stay's
 * editor.
 *
 * Found by period and by trip: both are query parameters, so a page is a page
 * and the total is the size of the filtered set.
 */
export function LodgingStaysView({ onAddHouse, onChanged }: LodgingStaysViewProps): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "common"]);
  const tableHints = useTableHints();
  const addToast = useToastStore((s) => s.addToast);

  const [rows, setRows] = useState<LodgingStayListItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [tripId, setTripId] = useState<string>("");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [editing, setEditing] = useState<LodgingStayListItem | null>(null);
  const [toDelete, setToDelete] = useState<LodgingStayListItem | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);
  // Bumped by anything that CHANGES rows (an edit, a delete) or retries a failed read.
  const [reloadToken, setReloadToken] = useState<number>(0);
  const reload = useCallback((): void => setReloadToken((token) => token + 1), []);

  // A window that ends before it begins is the user's slip, not a server
  // error: say so at the field and do not send it (the server would 400).
  const windowInvalid = from !== "" && to !== "" && from > to;
  const hasActiveFilter = from !== "" || to !== "" || tripId !== "";
  const filterSignature = `${from}|${to}|${tripId}`;
  const pagination = useServerPagination(total, "lodging-stays", filterSignature);
  const { limit, offset } = pagination;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const all = await tripsApi.getAll();
        if (!cancelled) setTrips(all);
      } catch (err: unknown) {
        // The trip filter goes quiet; the list itself still works.
        logger.error("LodgingStaysView: failed to load trips", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (windowInvalid) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const page = await listStayPage({
          ...(from !== "" && { from }),
          ...(to !== "" && { to }),
          ...(tripId !== "" && { tripId }),
          limit,
          offset,
        });
        if (cancelled) return;
        setRows(page.rows);
        setTotal(page.total);
      } catch (err: unknown) {
        if (cancelled) return;
        logger.error("LodgingStaysView: failed to load stays", err);
        setLoadError(true);
        setLoadFailure(loadFailureLog(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, tripId, limit, offset, reloadToken, windowInvalid]);

  const resetFilters = (): void => {
    setFrom("");
    setTo("");
    setTripId("");
  };

  const confirmDelete = async (): Promise<void> => {
    if (toDelete === null) return;
    setDeleting(true);
    try {
      await deleteStay(toDelete.lodgingId, toDelete.id);
    } catch (err: unknown) {
      logger.error("LodgingStaysView: stay delete failed", err);
      addToast("error", t("lodging:stay.deleteError"));
      setDeleting(false);
      setToDelete(null);
      return;
    }
    setDeleting(false);
    setToDelete(null);
    // The editor closes too: it is showing a stay that no longer exists.
    setEditing(null);
    addToast("success", t("lodging:stay.deleted"));
    reload();
    onChanged?.();
  };

  const columns = useMemo<TableColumn[]>(
    () =>
      COLUMNS.map((column) => ({
        ...column,
        label: t(`lodging:stayView.columns.${column.key}`),
      })),
    [t]
  );

  const cell = (stay: LodgingStayListItem): Record<ColumnKey, JSX.Element | string> => {
    const period = formatStayPeriod(stay, i18n.language, t).label;
    const detail = [
      stay.roomNumber ? t("lodging:stayView.room", { room: stay.roomNumber }) : null,
      stay.bookingReference
        ? t("lodging:stayView.reference", { reference: stay.bookingReference })
        : null,
    ].filter((part): part is string => part !== null);
    const lifecycle = lodgingLifecycleStatus([stay]);
    return {
      period: (
        <span className="flex flex-col">
          <span className="font-medium text-[var(--text-primary)]">{period}</span>
          {!hasUnknownLength(stay) && (
            <span className="text-xs text-[var(--text-muted)]">
              {t("lodging:field.nightsCount", { count: stayNights(stay) })}
            </span>
          )}
        </span>
      ),
      house: (
        <span className="flex flex-col">
          {/* The way to the house: a real link, so it opens in a new tab too.
              The row's own click edits the stay, hence the stopped propagation. */}
          <Link
            to={`/lodging/${stay.lodging.id}`}
            onClick={(event) => event.stopPropagation()}
            aria-label={t("lodging:stayView.openHouse", { name: stay.lodging.name })}
            className="font-medium text-[var(--text-primary)] underline-offset-4 hover:underline"
          >
            {stay.lodging.name}
          </Link>
          {(stay.lodging.city || detail.length > 0) && (
            <span className="text-xs text-[var(--text-muted)]">
              {[stay.lodging.city, ...detail].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
      ),
      trip: stay.trip?.name ?? "—",
      status: lifecycle ? <StayStatusPill status={lifecycle} /> : "—",
      actions: (
        <RowActions>
          <RowActionButton
            icon="edit"
            label={t("common:buttons.edit")}
            testId={`stay-view-edit-${stay.id}`}
            onClick={() => setEditing(stay)}
          />
          <RowActionButton
            icon="delete"
            label={t("common:buttons.delete")}
            testId={`stay-view-delete-${stay.id}`}
            onClick={() => setToDelete(stay)}
          />
        </RowActions>
      ),
    };
  };

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <FilterField label={t("lodging:stayView.filter.from")}>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className={INPUT_CLASS}
          />
        </FilterField>
        <div>
          <FilterField label={t("lodging:stayView.filter.to")}>
            <input
              id="stay-view-to"
              type="date"
              value={to}
              min={from || undefined}
              aria-invalid={windowInvalid || undefined}
              aria-describedby={windowInvalid ? "stay-view-to-error" : undefined}
              onChange={(e) => setTo(e.target.value)}
              className={INPUT_CLASS}
            />
          </FilterField>
          {/* Outside the label: inside it the sentence would become part of the field's name. */}
          <FieldError
            id="stay-view-to"
            error={windowInvalid ? t("lodging:stayView.filter.invalidWindow") : null}
          />
        </div>
        <FilterField label={t("lodging:stayView.filter.trip")}>
          <select
            value={tripId}
            onChange={(e) => setTripId(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">{t("lodging:stayView.filter.allTrips")}</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </select>
        </FilterField>
        {hasActiveFilter && (
          <div className="flex items-end">
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] pointer-coarse:min-h-(--ts-size-touch-min)"
            >
              {t("common:filters.reset")}
            </button>
          </div>
        )}
      </div>

      {loadError ? (
        <ListLoadFailed
          title={t("lodging:stayView.loadError")}
          onRetry={reload}
          log={loadFailure}
        />
      ) : windowInvalid ? null : loading ? (
        <SkeletonTable rows={10} />
      ) : rows.length === 0 ? (
        <div
          className="overflow-hidden rounded-lg"
          style={{ border: "1px solid var(--color-border)" }}
        >
          <ListEmptyState
            filtered={hasActiveFilter}
            emptyTitle={t("lodging:stayView.empty")}
            emptyHint={t("lodging:stayView.emptyHint")}
            onReset={resetFilters}
            action={{ label: t("lodging:add.title"), onClick: onAddHouse }}
          />
        </div>
      ) : (
        <>
          <TablePagination {...pagination} allowAll={false} placement="top" />
          <Table columns={columns} label={t("lodging:stayView.title")} {...tableHints}>
            {rows.map((stay) => {
              const cells = cell(stay);
              return (
                <TableRow
                  key={stay.id}
                  testId={`stay-view-row-${stay.id}`}
                  columns={columns}
                  onClick={() => setEditing(stay)}
                  cells={columns.map((column) => cells[column.key as ColumnKey])}
                />
              );
            })}
          </Table>
          <TablePagination {...pagination} allowAll={false} />
          <p className="mt-2 px-1 text-xs text-[var(--text-muted)]">
            {t("lodging:stayView.footer")}
          </p>
        </>
      )}

      {editing && (
        <StayEditor
          mode="edit"
          lodgingId={editing.lodging.id}
          lodgingName={editing.lodging.name}
          lodgingChainId={editing.lodging.chainId}
          lodgingCountryCode={editing.lodging.isoCountryCode}
          stay={editing}
          afterSaveFailedKey="common:form.savedButRefreshFailed"
          onRequestDelete={() => setToDelete(editing)}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            reload();
            onChanged?.();
          }}
        />
      )}

      <StayDeleteConfirm
        stay={toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => void confirmDelete()}
        deleting={deleting}
      />
    </>
  );
}
