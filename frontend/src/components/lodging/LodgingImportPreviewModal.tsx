import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import type {
  LodgingImportCommitRow,
  LodgingImportPreviewRow,
  LodgingImportSummary,
} from "../../types/lodgingImport";
import {
  isEmptyStay,
  priceLacksCurrency,
  toEditableRow,
  type EditableRow,
} from "./lodgingImportRowModel";
import { PreviewRowLine } from "./LodgingImportPreviewRow";

// Re-exported because the suite imports them from here, and because this
// is the surface everything else in the app already knows.
export { currencyOptionGroups, isEmptyStay, parseTotalPriceInput } from "./lodgingImportRowModel";

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
  const { t, i18n } = useTranslation(["lodging", "common"]);
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
    const changed = edited.filter((r) => r.decision === "update").length;
    return { newRows, alreadyPresent, needsInput, changed };
  }, [edited]);

  /**
   * The two bulk actions.
   *
   * A first lodging import has an unknown chain on very nearly every row,
   * so the per-row tick and the per-row action select are the same two
   * clicks repeated as often as the file is long — a tester measured ten
   * minutes on his own list (Alex, 2026-09-20). What was right about the
   * per-row design stays: an unknown chain is an OFFER, never a silent
   * create, and the reader still reads the list before deciding.
   *
   * So both act only on rows nobody has answered yet, never overwrite a
   * decision the reader already made by hand, and are two separate buttons
   * because they answer two separate questions — "import these" and "create
   * the chains they name".
   *
   * The undecided ones are exactly the `needs_input` rows: the server saw a
   * POSSIBLE match and declined to guess. So this button is named for what
   * it does — create them anyway — and not "accept", which would suggest
   * the server had recommended something. The hint under it says what is
   * being overruled; a reader who wants the matches keeps skipping by hand.
   */
  const undecidedCount = useMemo(() => edited.filter((r) => r.decision === "").length, [edited]);

  const uncheckedChains = useMemo(
    () =>
      edited.filter(
        (r) =>
          r.flags.includes("unknown_chain") &&
          r.lodging?.chainName !== undefined &&
          r.lodging.createChain !== true
      ).length,
    [edited]
  );

  const createAllUndecided = useCallback((): void => {
    setEdited((prev) => prev.map((r) => (r.decision === "" ? { ...r, decision: "create" } : r)));
  }, []);

  const createAllChains = useCallback((): void => {
    setEdited((prev) =>
      prev.map((r) =>
        r.flags.includes("unknown_chain") && r.lodging?.chainName !== undefined
          ? { ...r, lodging: { ...r.lodging, createChain: true } }
          : r
      )
    );
  }, []);

  const pricesWithoutCurrency = useMemo(() => edited.filter(priceLacksCurrency).length, [edited]);

  const canCommit = counts.needsInput === 0 && pricesWithoutCurrency === 0 && !saving;

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
        (r): r is EditableRow & { decision: "create" | "skip" | "update" } => r.decision !== ""
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
          .map((r) => r.lodging!.name.trim().toLowerCase())
      );

      const payload: LodgingImportCommitRow[] = decided.map((r) => ({
        sourceRowIndex: r.sourceRowIndex,
        action: r.decision,
        matchedLodgingId: r.matchedLodgingId,
        // An `update` row names the stay it PATCHES. A `create` row names the
        // stay it deliberately duplicates: "Anlegen" over a match is the user
        // saying "I know one is on file, make another". The server needs to be
        // told which, because the incoming external reference belongs to that
        // stay and cannot be held twice — without this the create hit the
        // unique index and was counted as a silent skip. Either way the id
        // comes from a response the client could have edited, so the server
        // re-checks that the stay is the caller's before it acts on it.
        // A `skip` row asks for nothing and sends nothing.
        matchedStayId: r.decision === "skip" ? null : r.matchedStayId,
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
          {counts.changed > 0 && (
            <>
              {" · "}
              {counts.changed} {t("lodging:import.preview.changedLabel")}
            </>
          )}
        </p>
        {summary.needsInput > 0 && (
          <p className="mb-3 text-xs text-amber-300/90">
            {t("lodging:import.preview.needsInputHint")}
          </p>
        )}
        {pricesWithoutCurrency > 0 && (
          <p data-testid="lodging-import-currency-hint" className="mb-3 text-xs text-amber-300/90">
            {t("lodging:import.preview.currencyMissingHint")}
          </p>
        )}

        {(undecidedCount > 0 || uncheckedChains > 0) && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {undecidedCount > 0 && (
              <button
                type="button"
                data-testid="lodging-import-create-all-undecided"
                onClick={createAllUndecided}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {t("lodging:import.preview.createAllUndecided", { count: undecidedCount })}
              </button>
            )}
            {uncheckedChains > 0 && (
              <button
                type="button"
                data-testid="lodging-import-create-all-chains"
                onClick={createAllChains}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {t("lodging:import.preview.createAllChains", { count: uncheckedChains })}
              </button>
            )}
          </div>
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
                <th className="p-2 text-left">{t("lodging:import.fields.currency")}</th>
                {/* No "Hinweise" column any more — see `PreviewRowLine`: the
                    hints are a full-width line under the fields, because a
                    180-px cell turned one sentence into three lines and
                    squeezed the action control until its own value read
                    "Übersp…" (owner, 2026-09-19). */}
                <th className="p-2 text-left">{t("lodging:import.fields.action")}</th>
              </tr>
            </thead>
            <tbody>
              {edited.map((row) => (
                <PreviewRowLine
                  key={row.sourceRowIndex}
                  row={row}
                  onChange={updateRow}
                  t={t}
                  language={i18n.language}
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
