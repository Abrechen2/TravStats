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
 * An UNMATCHED row's lodging/stay fields are editable regardless of which of
 * the "3 real shapes" (spec: types/lodgingImport.ts) the candidate started
 * as — e.g. a stays-only row whose free-text name failed to match
 * (`needs_input`, `unresolvable_lodging_name`) can be turned into a
 * brand-new lodging by filling in its city, which the commit service
 * (`lodgingImportCommit.ts`) happily accepts: it only reads `row.lodging`
 * when `matchedLodgingId` is still unset. These two helpers lazily create
 * the missing half on first edit instead of leaving the field disabled.
 *
 * A MATCHED row (`matchedLodgingId` already set) is the opposite case: the
 * commit service never reads `row.lodging` for it (it attaches a stay to the
 * existing lodging instead), so `PreviewRowLine` renders its name/city as
 * read-only rather than let the user edit a value that would be silently
 * discarded on commit.
 */
function ensureLodging(row: EditableRow, name: string): NonNullable<EditableRow["lodging"]> {
  return row.lodging ?? { name };
}
function ensureStay(row: EditableRow): NonNullable<EditableRow["stay"]> {
  return row.stay ?? { checkIn: "", checkOut: "" };
}

/**
 * `ensureStay` above is a one-way door: the first touch of ANY stay input on
 * a stay-less row materializes `stay: {checkIn: "", checkOut: ""}`, and
 * nothing in this UI ever sets `stay` back to `null` — there is no "clear
 * stay" control. If the user touches a stay field and then clears it again
 * (or never fills in real dates), the row would otherwise commit an
 * all-empty stay object that 400s wholesale on the backend's `isoDay` regex.
 * `handleCommit` calls this to fold such a stay back to `null` right before
 * building the payload, so a touch-then-clear on a places-only row is a
 * genuine no-op rather than a dead end.
 */
export function isEmptyStay(stay: NonNullable<EditableRow["stay"]>): boolean {
  return (
    stay.checkIn === "" &&
    stay.checkOut === "" &&
    stay.totalPrice == null &&
    stay.roomCategory == null &&
    stay.board == null &&
    stay.currency == null &&
    stay.ratingRoom == null &&
    stay.ratingBreakfast == null &&
    stay.ratingService == null &&
    stay.ratingOverall == null &&
    stay.bookingReference == null &&
    stay.externalRef == null &&
    stay.notes == null
  );
}

/**
 * Parses the raw string from the total-price `<input type="number">` into a
 * finite number or `null`. `??`/a plain falsy check does not catch `NaN`
 * (`NaN ?? 0` is still `NaN`) — without `Number.isFinite`, a malformed entry
 * would silently store `NaN` and echo "NaN" back into this controlled
 * input. Exported standalone (rather than inlined in the `onChange`) so it
 * can be unit-tested directly: jsdom (and real browsers) sanitize an
 * invalid `type="number"` DOM value to `""` before a change event ever
 * fires, so a DOM-level test cannot actually drive a non-numeric string
 * through `e.target.value`.
 */
export function parseTotalPriceInput(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
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
    // The real double-commit guard is the native `disabled` attribute on the
    // commit button below: `setSaving(true)` re-renders synchronously, so
    // `disabled` is already true before the browser can dispatch a second
    // click, and a disabled button never fires `click` at all. `canCommit`
    // here is just this closure's snapshot from render time (captured via
    // the `useCallback` dependency array below) — it is NOT re-evaluated on
    // a second click. The check below is a defensive fallback for the case
    // where `handleCommit` is invoked some other way that bypasses the DOM
    // `disabled` state (e.g. a directly dispatched click).
    if (!canCommit) return;
    setSaving(true);
    setError(null);
    try {
      const decided = edited.filter(
        (r): r is EditableRow & { decision: "create" | "skip" } => r.decision !== "",
      );

      // Names some OTHER row in this payload will create. Those rows keep the
      // established payload-name join (see the `lodging` comment below): they
      // travel with `lodging: null` and the backend attaches them to whatever
      // the creating row made. Comparison is a loose lower-case one rather
      // than a copy of the backend's normaliser — it only decides whether we
      // send the object at all, and the backend dedupes by name regardless, so
      // neither a false positive nor a false negative can duplicate a hotel.
      const createdByPayload = new Set(
        decided
          .filter((r) => r.decision === "create" && r.lodging?.name)
          .map((r) => r.lodging!.name.trim().toLowerCase()),
      );

      const payload: LodgingImportCommitRow[] = decided
        .map((r) => ({
          sourceRowIndex: r.sourceRowIndex,
          action: r.decision,
          matchedLodgingId: r.matchedLodgingId,
          // `ensureLodging` materialises the lodging object lazily, on the
          // first EDIT of a lodging field. A stays-only row the user simply
          // marked "create" — hotel name plus dates, nothing to edit — never
          // triggered that, so it went out as `lodging: null` and the backend
          // answered `missing_lodging_reference` and created NOTHING. That is
          // the whole "0 Hotel(s) und 0 Aufenthalt(e) angelegt" report Alex
          // hit on 2026-08-09 with a CSV of stays.
          //
          // Choosing "create" IS the instruction to create it, and the name is
          // the one field such a row always carries. Two rows keep `null`: one
          // the user chose to SKIP (inventing a lodging there would create a
          // hotel they just declined), and one whose name another row in this
          // payload already creates (the payload-name join, unchanged).
          lodging:
            r.lodging ??
            (r.decision === "create" &&
            r.lodgingName &&
            !createdByPayload.has(r.lodgingName.trim().toLowerCase())
              ? { name: r.lodgingName }
              : null),
          // An UNEDITED stays-only row the preview matched by free-text name
          // against ANOTHER candidate in this same payload (`lodging` stays
          // null, no dedupe hint) still needs that name at commit time — the
          // commit service resolves it against the lodging the other row
          // creates. Harmless to send even when `lodging` is set: the backend
          // only consults it when `lodging` is null.
          lodgingName: r.lodgingName ?? null,
          // See `isEmptyStay` — fold a touched-then-cleared stay back to null
          // instead of sending an all-empty stay that fails the backend's
          // date validation.
          stay: r.stay && isEmptyStay(r.stay) ? null : r.stay,
        }));
      await onCommit(payload);
    } catch (err) {
      // Log the real error for diagnostics, but never surface the raw
      // thrown message to the user — it may be untranslated/English and can
      // leak internal detail. Always show the fixed, translated string.
      logger.error("LodgingImportPreviewModal: commit failed", err);
      setError(t("lodging:import.preview.commitError"));
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
  // A matched row attaches its stay to the EXISTING lodging on commit — the
  // commit service never reads `row.lodging` for it (lodgingImportCommit.ts:
  // `if (!lodgingId && row.lodging)`). Editing name/city here would look
  // saved but be silently discarded, so these two fields render read-only
  // instead of as editable inputs. Note `matchedLodgingId` can be set with
  // `dedupeHint === "none"` (the stays-only by-name join never sets a
  // dedupe hint), so this must be its own check, not derived from
  // `showDedupeHint`.
  const isMatched = row.matchedLodgingId !== null;

  return (
    <tr
      className={
        row.decision === ""
          ? "border-t border-[var(--color-border)] bg-amber-500/5"
          : "border-t border-[var(--color-border)]"
      }
    >
      <td className="p-2">
        {isMatched ? (
          <div>
            <div
              data-testid={`lodging-import-name-${sourceRowIndex}`}
              aria-label={t("lodging:import.fields.name")}
              title={t("lodging:import.matchedLodgingHint")}
              className={`${INPUT} cursor-not-allowed truncate text-[var(--text-muted)]`}
            >
              {name}
            </div>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              {t("lodging:import.matchedLodgingHint")}
            </p>
          </div>
        ) : (
          <input
            data-testid={`lodging-import-name-${sourceRowIndex}`}
            value={name}
            onChange={(e): void =>
              onChange(sourceRowIndex, {
                // Immutable: a NEW lodging object, never a mutation of the
                // prop. Mirrors the city-edit path below: a name edit on a
                // NON-matched row must materialize `row.lodging` — otherwise
                // `commitRowSchema` has no `lodgingName` field, commit reads
                // only `lodging`/`matchedLodgingId`, and an unresolved row the
                // user only renamed is guaranteed to fail with
                // `missing_lodging_reference`.
                lodging: { ...ensureLodging(row, name), name: e.target.value },
                lodgingName: e.target.value,
              })
            }
            aria-label={t("lodging:import.fields.name")}
            className={INPUT}
          />
        )}
      </td>
      <td className="p-2">
        {isMatched ? (
          <div
            data-testid={`lodging-import-city-${sourceRowIndex}`}
            aria-label={t("lodging:import.fields.city")}
            title={t("lodging:import.matchedLodgingHint")}
            className={`${INPUT} cursor-not-allowed truncate text-[var(--text-muted)]`}
          >
            {row.lodging?.city ?? ""}
          </div>
        ) : (
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
        )}
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
              stay: { ...ensureStay(row), totalPrice: parseTotalPriceInput(e.target.value) },
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
          {/* An unknown chain is an OFFER, never a silent create — the commit
              stopped adding whatever a parser took for a chain. One tick per
              row decides it; unticked, the house imports without a chain. */}
          {row.flags.includes("unknown_chain") && row.lodging?.chainName && (
            <label className="flex items-center gap-1 text-[10px] text-amber-300">
              <input
                type="checkbox"
                checked={row.lodging.createChain === true}
                onChange={(e): void =>
                  onChange(sourceRowIndex, {
                    lodging: { ...row.lodging!, createChain: e.target.checked },
                  })
                }
                className="h-3 w-3"
              />
              {t("lodging:import.createChain", { name: row.lodging.chainName })}
            </label>
          )}
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
