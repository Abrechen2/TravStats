import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { LocationInput, type LocationSelection } from "../location/LocationInput";
import type {
  PlaceImportCandidate,
  PlaceImportPreviewRow,
  PlaceImportSummary,
} from "../../types/placeImport";

export interface PlaceImportPreviewModalProps {
  rows: PlaceImportPreviewRow[];
  summary: PlaceImportSummary;
  /**
   * Called with the rows the user decided to CREATE, as plain candidates —
   * the commit schema has no action field, so a skipped row is simply not
   * sent. This modal never sees the commit result; the caller presents it
   * (`describePlaceCommitResult`). If `onCommit` rejects, the error is shown
   * inline and the modal stays open so the user can retry.
   */
  onCommit: (rows: PlaceImportCandidate[]) => Promise<void>;
  onCancel: () => void;
}

/**
 * The row plus the user's in-modal decisions. Immutable updates only.
 * `decision` excludes "needs_input": the select offers "" / "create" / "skip",
 * so a resolved row can never regress to `needs_input` through the UI.
 */
interface EditableRow extends PlaceImportPreviewRow {
  /** "" while a needs_input row is still undecided. */
  decision: "" | "create" | "skip";
  /** The position picker is open under this row. */
  picking: boolean;
}

const INPUT =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none";

function toEditableRow(row: PlaceImportPreviewRow): EditableRow {
  return {
    ...row,
    decision: row.action === "needs_input" ? "" : row.action,
    picking: false,
  };
}

function hasPosition(row: PlaceImportCandidate): row is PlaceImportCandidate & {
  lat: number;
  lon: number;
} {
  return (
    typeof row.lat === "number" &&
    typeof row.lon === "number" &&
    Number.isFinite(row.lat) &&
    Number.isFinite(row.lon)
  );
}

/** The candidate part of a row — what the commit endpoint accepts. */
export function toCandidate(row: PlaceImportPreviewRow): PlaceImportCandidate {
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
  };
}

/**
 * Post-import review for places — POI Phase D §5: "an unplaceable row is an
 * OFFER, not a drop, and so cannot ship without somewhere to make the offer."
 * This is that somewhere.
 *
 * Two kinds of row wait for the user (`needs_input`):
 *   - no coordinates (every row of a Google Takeout export) — the row opens a
 *     position picker; once a position is set the row may be created;
 *   - a same-name place within a few hundred metres that shares no identity —
 *     only the user can say whether it is the same place, so they choose.
 *
 * The backend already ordered nothing and this component does not re-sort as
 * the user edits: a row jumping away mid-decision is worse than a stale place.
 */
export function PlaceImportPreviewModal({
  rows,
  summary,
  onCommit,
  onCancel,
}: PlaceImportPreviewModalProps): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edited, setEdited] = useState<EditableRow[]>(() => rows.map(toEditableRow));

  const updateRow = useCallback((sourceRowIndex: number, patch: Partial<EditableRow>): void => {
    setEdited((prev) =>
      prev.map((r) => (r.sourceRowIndex === sourceRowIndex ? { ...r, ...patch } : r))
    );
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
    const newRows = edited.filter((r) => r.decision === "create").length;
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
      const payload = edited
        .filter((r) => r.decision === "create")
        // A "create" without a position cannot be chosen through the UI (the
        // select withholds the option), so this filter is a belt for that
        // brace: the backend would report it as `no_position` anyway.
        .filter(hasPosition)
        .map(toCandidate);
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
                <PreviewRowLine
                  key={row.sourceRowIndex}
                  row={row}
                  onChange={updateRow}
                  onPlace={placeRow}
                  t={t}
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

interface PreviewRowLineProps {
  row: EditableRow;
  onChange: (sourceRowIndex: number, patch: Partial<EditableRow>) => void;
  onPlace: (row: EditableRow, sel: LocationSelection) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function PreviewRowLine({ row, onChange, onPlace, t }: PreviewRowLineProps): JSX.Element {
  const { sourceRowIndex } = row;
  const positioned = hasPosition(row);
  const undecided = row.decision === "";
  const rowClass = undecided
    ? "border-t border-[var(--color-border)] bg-amber-500/5"
    : "border-t border-[var(--color-border)]";

  return (
    <>
      <tr className={rowClass}>
        <td className="p-2">
          <input
            data-testid={`place-import-name-${sourceRowIndex}`}
            value={row.name}
            onChange={(e): void => onChange(sourceRowIndex, { name: e.target.value })}
            aria-label={t("places:import.fields.name")}
            className={INPUT}
          />
        </td>
        <td className="p-2 whitespace-nowrap">
          {positioned ? (
            <span
              data-testid={`place-import-position-${sourceRowIndex}`}
              className="font-mono text-xs text-[var(--text-primary)]"
            >
              {row.lat.toFixed(4)} · {row.lon.toFixed(4)}
            </span>
          ) : (
            <button
              type="button"
              data-testid={`place-import-pick-${sourceRowIndex}`}
              onClick={(): void => onChange(sourceRowIndex, { picking: !row.picking })}
              className="rounded-md border border-amber-400/40 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/10"
            >
              {t("places:import.pickPosition")}
            </button>
          )}
        </td>
        <td className="p-2 text-[var(--text-muted)]">
          {[row.city, row.country].filter(Boolean).join(" · ") || "—"}
        </td>
        <td className="p-2 font-mono text-xs text-[var(--text-muted)]">{row.visitedAt ?? "—"}</td>
        <td className="p-2">
          <div className="flex flex-wrap gap-1">
            {row.flags.map((flag) => (
              <span
                key={flag}
                title={t(`places:import.flags.${flag}`)}
                className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300"
              >
                {t(`places:import.flags.${flag}`)}
              </span>
            ))}
            {row.dedupeHint !== "none" && (
              <span
                title={t(`places:import.dedupeHints.${row.dedupeHint}`)}
                className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300"
              >
                {t(`places:import.dedupeHints.${row.dedupeHint}`)}
              </span>
            )}
          </div>
        </td>
        <td className="p-2">
          <select
            data-testid={`place-import-action-${sourceRowIndex}`}
            value={row.decision}
            onChange={(e): void =>
              onChange(sourceRowIndex, { decision: e.target.value as EditableRow["decision"] })
            }
            aria-label={t("places:import.fields.action")}
            className={INPUT}
          >
            <option value="">{t("places:import.actions.choose")}</option>
            {/* "Create" only once the row can be created: a Place is a point,
                and the backend would refuse the row as `no_position`. */}
            {positioned && <option value="create">{t("places:import.actions.create")}</option>}
            <option value="skip">{t("places:import.actions.skip")}</option>
          </select>
        </td>
      </tr>
      {row.picking && !positioned && (
        <tr className="border-t border-[var(--color-border)] bg-amber-500/5">
          <td colSpan={6} className="p-3">
            <LocationInput
              value={null}
              onChange={(sel): void => onPlace(row, sel)}
              compact
              idPrefix={`place-import-${sourceRowIndex}`}
              label={t("places:import.pickPositionFor", { name: row.name })}
            />
          </td>
        </tr>
      )}
    </>
  );
}
