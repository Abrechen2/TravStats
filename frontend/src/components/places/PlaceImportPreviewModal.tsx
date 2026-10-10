import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useCoarsePointer } from "../../hooks/useCoarsePointer";
import { logger } from "../../lib/logger";
import type { LocationSelection } from "../location/LocationInput";
import { applyResolution, rowsToResolve } from "../../lib/placeImportTakeout";
import { PlaceImportPreviewRow, rowHasPosition, type EditableRow } from "./PlaceImportPreviewRow";
import { TakeoutResolvePanel } from "./TakeoutResolvePanel";
import type {
  PlaceImportCandidate,
  PlaceImportPreviewRow as PreviewRow,
  PlaceImportResolution,
  PlaceImportSummary,
} from "../../types/placeImport";

export interface PlaceImportPreviewModalProps {
  rows: PreviewRow[];
  summary: PlaceImportSummary;
  /**
   * The list's name, for a Google Takeout export (#358): Takeout names each
   * list's file after the list, and a list named after a country maps to the
   * user's trip there. Null when unknown.
   */
  listName?: string | null;
  /**
   * Called with the rows the user decided to WRITE, as plain candidates —
   * a skipped row is simply not sent; a trip stop or "my stay" row carries its
   * `treatment`. This modal never sees the commit result; the caller presents
   * it (`describePlaceCommitResult`). If `onCommit` rejects, the error is shown
   * inline and the modal stays open so the user can retry.
   */
  onCommit: (rows: PlaceImportCandidate[]) => Promise<void>;
  onCancel: () => void;
}

function toEditableRow(row: PreviewRow): EditableRow {
  return {
    ...row,
    decision: row.action === "needs_input" ? "" : row.action,
    picking: false,
    takeout: null,
  };
}

/** The candidate part of a row — what the commit endpoint accepts. */
export function toCandidate(row: PreviewRow): PlaceImportCandidate {
  return {
    sourceRowIndex: row.sourceRowIndex,
    name: row.name,
    lat: row.lat ?? null,
    lon: row.lon ?? null,
    category: row.category ?? null,
    address: row.address ?? null,
    city: row.city ?? null,
    country: row.country ?? null,
    notes: row.notes ?? null,
    visitedAt: row.visitedAt ?? null,
    externalRef: row.externalRef ?? null,
    ...(row.tripId ? { tripId: row.tripId } : {}),
  };
}

/** What the commit writes for a decided row; null for a row it must not see. */
function toCommitRow(row: EditableRow): PlaceImportCandidate | null {
  if (row.decision === "stay" && row.lodgingStayId) {
    return { ...toCandidate(row), treatment: "stay", lodgingStayId: row.lodgingStayId };
  }
  // A Place and a stop are points: a row without one cannot be chosen through
  // the UI (the select withholds the option), so this is a belt for that brace.
  if (!rowHasPosition(row)) return null;
  if (row.decision === "trip_stop" && row.tripId) {
    return { ...toCandidate(row), treatment: "trip_stop" };
  }
  return row.decision === "create" ? toCandidate(row) : null;
}

const WRITES = new Set<EditableRow["decision"]>(["create", "trip_stop", "stay"]);

/**
 * Post-import review for places — POI Phase D §5: "an unplaceable row is an
 * OFFER, not a drop, and so cannot ship without somewhere to make the offer."
 * This is that somewhere.
 *
 * Two kinds of row wait for the user (`needs_input`):
 *   - no coordinates (every row of a Google Takeout export) — the row opens a
 *     position picker, or the Takeout panel resolves it (#358);
 *   - a same-name place within a few hundred metres that shares no identity —
 *     only the user can say whether it is the same place, so they choose.
 *
 * The Takeout panel's suggestions — position, trip, day from photographs, and
 * a treatment by kind (place, trip stop, the user's stay, skip a city) — are
 * pre-selected only on undecided rows and stay visible on every row they
 * touched. The backend already ordered nothing and this component does not
 * re-sort as the user edits: a row jumping away mid-decision is worse than a
 * stale place.
 */
export function PlaceImportPreviewModal({
  rows,
  summary,
  listName = null,
  onCommit,
  onCancel,
}: PlaceImportPreviewModalProps): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const coarse = useCoarsePointer();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edited, setEdited] = useState<EditableRow[]>(() => rows.map(toEditableRow));
  // Computed once from what the file brought, so the panel's request does not
  // change under it as the user decides rows.
  const [resolvable] = useState(() => rowsToResolve(rows).map(toCandidate));

  const updateRow = useCallback((sourceRowIndex: number, patch: Partial<EditableRow>): void => {
    setEdited((prev) =>
      prev.map((r) => (r.sourceRowIndex === sourceRowIndex ? { ...r, ...patch } : r))
    );
  }, []);

  const onResolved = useCallback((resolution: PlaceImportResolution): void => {
    setEdited((prev) => applyResolution(prev, resolution));
  }, []);

  /**
   * A picked position fills the coordinates and whatever the row did not carry
   * — but never overwrites something the file said. The identity IS replaced:
   * it belongs to the coordinates, and picking a place makes it that place.
   * A row with a position and no other open question becomes "create"; one
   * still carrying a nearby-duplicate hint keeps waiting for that decision.
   */
  const placeRow = useCallback(
    (row: EditableRow, sel: LocationSelection): void => {
      updateRow(row.sourceRowIndex, {
        lat: sel.lat,
        lon: sel.lon,
        externalRef: sel.externalRef ?? row.externalRef ?? null,
        address: row.address ?? sel.address ?? null,
        city: row.city ?? sel.city ?? null,
        country: row.country ?? sel.country ?? null,
        flags: row.flags.filter((f) => f !== "missing_coordinates"),
        decision:
          row.decision === "" && row.dedupeHint !== "place_nearby" ? "create" : row.decision,
        picking: false,
      });
    },
    [updateRow]
  );

  // Live counts — they must follow the user's decisions, not restate the
  // server's first impression (`summary` is kept for the static hint only).
  const counts = useMemo(() => {
    const newRows = edited.filter((r) => WRITES.has(r.decision)).length;
    const alreadyPresent = edited.filter((r) => r.decision === "skip").length;
    const needsInput = edited.filter((r) => r.decision === "").length;
    return { newRows, alreadyPresent, needsInput };
  }, [edited]);

  // Nothing undecided, and something to write: a button that "imports 0 rows"
  // promises work the server would not do.
  const canCommit = counts.needsInput === 0 && counts.newRows > 0 && !saving;

  const handleCommit = useCallback(async (): Promise<void> => {
    // The real double-commit guard is the native `disabled` attribute on the
    // button: `setSaving(true)` re-renders synchronously, and a disabled
    // button never fires `click`. This check covers a call that bypasses it.
    if (!canCommit) return;
    setSaving(true);
    setError(null);
    try {
      const payload = edited.map(toCommitRow).filter((r): r is PlaceImportCandidate => r !== null);
      await onCommit(payload);
    } catch (err) {
      // Log the real error for diagnostics; never surface the raw message —
      // it may be untranslated and can leak internal detail.
      logger.error("PlaceImportPreviewModal: commit failed", err);
      setError(t("places:import.preview.commitError"));
    } finally {
      setSaving(false);
    }
  }, [canCommit, edited, onCommit, t]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-[var(--bg-surface)] p-6">
        <h2 className="mb-1 text-xl font-semibold text-[var(--text-primary)]">
          {t("places:import.preview.title", { count: rows.length })}
        </h2>
        {/* Plain JSX values, not one interpolated string: the global i18n test
            mock returns the bare key and drops every option, so a single
            interpolated key could not be asserted. Each label still goes
            through t(). */}
        <p data-testid="place-import-counts" className="mb-1 text-sm text-[var(--text-muted)]">
          {counts.newRows} {t("places:import.preview.newLabel")}
          {" · "}
          {counts.alreadyPresent} {t("places:import.preview.presentLabel")}
          {" · "}
          {counts.needsInput} {t("places:import.preview.needsInputLabel")}
        </p>
        {summary.needsInput > 0 && (
          <p className="mb-3 text-xs text-amber-300/90">
            {t("places:import.preview.needsInputHint")}
          </p>
        )}

        <TakeoutResolvePanel rows={resolvable} listName={listName} onResolved={onResolved} t={t} />

        {error !== null && (
          <p
            role="alert"
            className="mb-3 rounded border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--color-border)]">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-[var(--bg-base)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="p-2 text-left">{t("places:import.fields.name")}</th>
                <th className="p-2 text-left">{t("places:import.fields.position")}</th>
                <th className="p-2 text-left">{t("places:import.fields.city")}</th>
                <th className="p-2 text-left">{t("places:import.fields.visitedAt")}</th>
                <th className="p-2 text-left">{t("places:import.fields.hints")}</th>
                <th className="p-2 text-left">{t("places:import.fields.action")}</th>
              </tr>
            </thead>
            <tbody>
              {edited.map((row) => (
                <PlaceImportPreviewRow
                  key={row.sourceRowIndex}
                  row={row}
                  onChange={updateRow}
                  onPlace={placeRow}
                  t={t}
                  coarse={coarse}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {t("common:buttons.cancel")}
          </button>
          <button
            type="button"
            data-testid="place-import-commit"
            onClick={(): void => void handleCommit()}
            disabled={!canCommit}
            className="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t("common:loading.default") : t("places:import.preview.commit")}
          </button>
        </div>
      </div>
    </div>
  );
}
