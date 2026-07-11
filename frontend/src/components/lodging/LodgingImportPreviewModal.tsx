import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import type {
  LodgingImportCommitRow,
  LodgingImportPreviewRow,
  LodgingImportSummary,
} from "../../types/lodgingImport";

export interface LodgingImportPreviewModalProps {
  rows: LodgingImportPreviewRow[];
  summary: LodgingImportSummary;
  /**
   * Called with the user's final decisions. Rows the user left as
   * `needs_input` are excluded. NOTE: this modal never sees the commit
   * result (`LodgingImportCommitResult`) — the caller (page/adapter, Task
   * 16) is responsible for calling the commit endpoint, presenting counts
   * (`createdLodgings`/`createdStays`/`skipped`), and surfacing any
   * `failed[]` entries (including a partial success) to the user. If
   * `onCommit` rejects, this modal shows the thrown error inline and keeps
   * the modal open so the user can retry.
   */
  onCommit: (rows: LodgingImportCommitRow[]) => Promise<void>;
  onCancel: () => void;
}

/**
 * The row plus the user's in-modal edits. Immutable updates only.
 * `decision` deliberately excludes "needs_input" — the <select> only ever
 * offers "" / "create" / "skip", so a resolved row can never regress back
 * to `needs_input` through the UI.
 */
interface EditableRow extends LodgingImportPreviewRow {
  /** "" while a needs_input row is still undecided. */
  decision: "" | "create" | "skip";
}

const INPUT =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none";

function toEditableRow(row: LodgingImportPreviewRow): EditableRow {
  return { ...row, decision: row.action === "needs_input" ? "" : row.action };
}

/**
 * Every row's lodging/stay fields are editable regardless of which of the
 * "3 real shapes" (spec: types/lodgingImport.ts) the candidate started as —
 * e.g. a stays-only row whose free-text name failed to match (`needs_input`,
 * `unresolvable_lodging_name`) can be turned into a brand-new lodging by
 * filling in its city, which the commit service (`lodgingImportCommit.ts`)
 * happily accepts: it only reads `row.lodging` when `matchedLodgingId` is
 * still unset. These two helpers lazily create the missing half on first
 * edit instead of leaving the field disabled.
 */
function ensureLodging(row: EditableRow, name: string): NonNullable<EditableRow["lodging"]> {
  return row.lodging ?? { name };
}
function ensureStay(row: EditableRow): NonNullable<EditableRow["stay"]> {
  return row.stay ?? { checkIn: "", checkOut: "" };
}

/**
 * Post-import review — the single editable table BOTH the email/PDF and the
 * CSV import paths land in. The backend already ordered `rows` questionable
 * first (spec §3.1); this component intentionally does NOT re-sort as the
 * user edits, since a row jumping away mid-keystroke is worse than a stale
 * position.
 */
export function LodgingImportPreviewModal({
  rows,
  summary,
  onCommit,
  onCancel,
}: LodgingImportPreviewModalProps): JSX.Element {
  const { t } = useTranslation(["lodging", "common"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [edited, setEdited] = useState<EditableRow[]>(() => rows.map(toEditableRow));

  const updateRow = useCallback((sourceRowIndex: number, patch: Partial<EditableRow>): void => {
    setEdited((prev) =>
      prev.map((r) => (r.sourceRowIndex === sourceRowIndex ? { ...r, ...patch } : r))
    );
  }, []);

  // Live counts — must react to the user's edits, not restate the server's
  // first impression (`summary`, kept only for the static needsInputHint).
  const counts = useMemo(() => {
    const newRows = edited.filter((r) => r.decision === "create").length;
    const alreadyPresent = edited.filter((r) => r.decision === "skip").length;
    const needsInput = edited.filter((r) => r.decision === "").length;
    return { newRows, alreadyPresent, needsInput };
  }, [edited]);

  const canCommit = counts.needsInput === 0 && !saving;

  const handleCommit = useCallback(async (): Promise<void> => {
    // `saving` is flipped synchronously before the first await, and the
    // commit button is disabled while `saving` is true — a double-click
    // can queue at most one extra synchronous click before React re-renders
    // with `disabled`, and that second click is a no-op because `canCommit`
    // is re-evaluated from the same `saving` flag.
    if (!canCommit) return;
    setSaving(true);
    setError(null);
    try {
      const payload: LodgingImportCommitRow[] = edited
        .filter((r): r is EditableRow & { decision: "create" | "skip" } => r.decision !== "")
        .map((r) => ({
          sourceRowIndex: r.sourceRowIndex,
          action: r.decision,
          matchedLodgingId: r.matchedLodgingId,
          lodging: r.lodging,
          stay: r.stay,
        }));
      await onCommit(payload);
    } catch (err) {
      logger.error("LodgingImportPreviewModal: commit failed", err);
      setError(err instanceof Error ? err.message : t("lodging:import.preview.commitError"));
    } finally {
      setSaving(false);
    }
  }, [canCommit, edited, onCommit, t]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-[var(--bg-surface)] p-6">
        <h2 className="mb-1 text-xl font-semibold text-[var(--text-primary)]">
          {t("lodging:import.preview.title", { count: rows.length })}
        </h2>
        {/*
          The three numbers are rendered as plain JSX values, NOT baked into
          one interpolated t() string — a single interpolated key can't be
          unit-tested here, since the project's global react-i18next test
          mock (src/__tests__/setup.ts) returns the bare key and discards
          every interpolation option. Each label still goes through t().
        */}
        <p data-testid="lodging-import-counts" className="mb-1 text-sm text-[var(--text-muted)]">
          {counts.newRows} {t("lodging:import.preview.newLabel")}
          {" · "}
          {counts.alreadyPresent} {t("lodging:import.preview.presentLabel")}
          {" · "}
          {counts.needsInput} {t("lodging:import.preview.needsInputLabel")}
        </p>
        {summary.needsInput > 0 && (
          <p className="mb-3 text-xs text-amber-300/90">
            {t("lodging:import.preview.needsInputHint")}
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
                <th className="p-2 text-left">{t("lodging:import.fields.name")}</th>
                <th className="p-2 text-left">{t("lodging:import.fields.city")}</th>
                <th className="p-2 text-left">{t("lodging:import.fields.checkIn")}</th>
                <th className="p-2 text-left">{t("lodging:import.fields.checkOut")}</th>
                <th className="p-2 text-left">{t("lodging:import.fields.totalPrice")}</th>
                <th className="p-2 text-left">{t("lodging:import.fields.hints")}</th>
                <th className="p-2 text-left">{t("lodging:import.fields.action")}</th>
              </tr>
            </thead>
            <tbody>
              {edited.map((row) => (
                <PreviewRowLine key={row.sourceRowIndex} row={row} onChange={updateRow} t={t} />
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
            data-testid="lodging-import-commit"
            onClick={(): void => void handleCommit()}
            disabled={!canCommit}
            className="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t("common:loading.default") : t("lodging:import.preview.commit")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PreviewRowLineProps {
  row: EditableRow;
  onChange: (sourceRowIndex: number, patch: Partial<EditableRow>) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function PreviewRowLine({ row, onChange, t }: PreviewRowLineProps): JSX.Element {
  const { sourceRowIndex } = row;
  const name = row.lodging?.name ?? row.lodgingName ?? "";
  // A row can be `action: "create"` while `matchedLodgingId` already points
  // at an existing hotel — that row creates a STAY, not a new hotel. Show
  // the dedupe hint whenever a match exists, independent of the chosen
  // action, so the user is never told a hotel will be added when it won't.
  const showDedupeHint = row.dedupeHint !== "none";

  return (
    <tr
      className={
        row.decision === ""
          ? "border-t border-[var(--color-border)] bg-amber-500/5"
          : "border-t border-[var(--color-border)]"
      }
    >
      <td className="p-2">
        <input
          data-testid={`lodging-import-name-${sourceRowIndex}`}
          value={name}
          onChange={(e): void =>
            onChange(sourceRowIndex, {
              // Immutable: a NEW lodging object, never a mutation of the prop.
              lodging: row.lodging ? { ...row.lodging, name: e.target.value } : null,
              lodgingName: e.target.value,
            })
          }
          aria-label={t("lodging:import.fields.name")}
          className={INPUT}
        />
      </td>
      <td className="p-2">
        <input
          data-testid={`lodging-import-city-${sourceRowIndex}`}
          value={row.lodging?.city ?? ""}
          onChange={(e): void =>
            onChange(sourceRowIndex, {
              lodging: { ...ensureLodging(row, name), city: e.target.value },
            })
          }
          aria-label={t("lodging:import.fields.city")}
          className={INPUT}
        />
      </td>
      <td className="p-2">
        <input
          type="date"
          data-testid={`lodging-import-checkin-${sourceRowIndex}`}
          value={row.stay?.checkIn ?? ""}
          onChange={(e): void =>
            onChange(sourceRowIndex, {
              stay: { ...ensureStay(row), checkIn: e.target.value },
            })
          }
          style={{ colorScheme: "dark" }}
          aria-label={t("lodging:import.fields.checkIn")}
          className={INPUT}
        />
      </td>
      <td className="p-2">
        <input
          type="date"
          data-testid={`lodging-import-checkout-${sourceRowIndex}`}
          value={row.stay?.checkOut ?? ""}
          onChange={(e): void =>
            onChange(sourceRowIndex, {
              stay: { ...ensureStay(row), checkOut: e.target.value },
            })
          }
          style={{ colorScheme: "dark" }}
          aria-label={t("lodging:import.fields.checkOut")}
          className={INPUT}
        />
      </td>
      <td className="p-2">
        <input
          type="number"
          data-testid={`lodging-import-price-${sourceRowIndex}`}
          value={row.stay?.totalPrice ?? ""}
          onChange={(e): void =>
            onChange(sourceRowIndex, {
              stay: {
                ...ensureStay(row),
                totalPrice: e.target.value ? Number(e.target.value) : null,
              },
            })
          }
          aria-label={t("lodging:import.fields.totalPrice")}
          className={INPUT}
        />
      </td>
      <td className="p-2">
        <div className="flex flex-wrap gap-1">
          {row.flags.map((flag) => (
            <span
              key={flag}
              title={t(`lodging:import.flags.${flag}`)}
              className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300"
            >
              {t(`lodging:import.flags.${flag}`)}
            </span>
          ))}
          {showDedupeHint && (
            <span
              title={t(`lodging:import.dedupeHints.${row.dedupeHint}`)}
              className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300"
            >
              {t(`lodging:import.dedupeHints.${row.dedupeHint}`)}
            </span>
          )}
        </div>
      </td>
      <td className="p-2">
        <select
          data-testid={`lodging-import-action-${sourceRowIndex}`}
          value={row.decision}
          onChange={(e): void =>
            onChange(sourceRowIndex, {
              decision: e.target.value as EditableRow["decision"],
            })
          }
          aria-label={t("lodging:import.fields.action")}
          className={INPUT}
        >
          <option value="">{t("lodging:import.actions.choose")}</option>
          <option value="create">{t("lodging:import.actions.create")}</option>
          <option value="skip">{t("lodging:import.actions.skip")}</option>
        </select>
      </td>
    </tr>
  );
}
