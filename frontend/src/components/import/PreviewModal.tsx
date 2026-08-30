import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { hasHardError, type PreviewFlag, type PreviewRowEnriched } from "../../lib/api/import";

export interface PreviewCommitResult {
  committed: number;
  failedChunks: number;
  /**
   * Rows the server already held from an earlier import of the same file.
   * Deliberately NOT called "skipped": that word is already taken here for
   * rows the USER unticked, and telling the two apart is the whole point —
   * one is a decision, the other is the import doing its job.
   */
  alreadyPresent?: number;
  failureMessage?: string;
}

export interface PreviewModalProps {
  rows: PreviewRowEnriched[];
  summary: { ok: number; problems: number; duplicates: number; unresolvable: number };
  /**
   * Persist the rows to the API. Returns an aggregated commit result so the
   * modal can transition to its `success` view with the actual count. The
   * parent should NOT close the modal — that is owned by the modal itself
   * via `onClose`, which fires after success-state dismissal or cancel.
   */
  onCommit: (rows: PreviewRowEnriched[]) => Promise<PreviewCommitResult>;
  onClose: () => void;
  /** Optional link target shown in the success view (e.g. "/flights"). */
  flightsListHref?: string;
}

type SubmitState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | {
      phase: "success";
      committed: number;
      skipped: number;
      alreadyPresent: number;
      failedChunks: number;
    }
  | { phase: "error"; message: string };

const WARNING_FLAGS = ["duration_mismatch"] as const;
type WarningFlag = (typeof WARNING_FLAGS)[number];

function isWarningFlag(f: PreviewFlag): f is WarningFlag {
  return (WARNING_FLAGS as readonly PreviewFlag[]).includes(f);
}

function formatDate(isoString: string): string {
  return isoString.slice(0, 10);
}

export function PreviewModal({
  rows,
  summary,
  onCommit,
  onClose,
  flightsListHref,
}: PreviewModalProps): JSX.Element {
  const { t } = useTranslation("settings");

  const initialChecked = useMemo(() => {
    const m = new Map<number, boolean>();
    for (const r of rows) {
      // A row the server already holds is pre-UNTICKED, because ticking it
      // achieves nothing: commit skips it and reports it as already present.
      //
      // Forgejo #4: importing the same CSV twice showed "0 bereit · 1 Duplikate
      // · 0 Probleme" above a live button reading "1 Zeile importieren", which
      // then imported nothing. The count came from the ticked rows, and a
      // duplicate is not a hard error, so it stayed ticked — the button
      // promised work the server had already decided not to do.
      //
      // ONLY `exact_match` (same day, same flight number). `same_day_same_route`
      // is a suspicion, not a fact: two different flights can share a day and a
      // route, and pre-unticking those would quietly drop real rows. The row
      // stays visible and tickable either way, so forcing an import is still
      // one click.
      const alreadyHeld = r.dedupeHint === "exact_match";
      m.set(r.sourceRowIndex, !hasHardError(r.flags) && !alreadyHeld);
    }
    return m;
  }, [rows]);
  const [checked, setChecked] = useState<Map<number, boolean>>(initialChecked);
  const [submitState, setSubmitState] = useState<SubmitState>({ phase: "idle" });

  useEffect(() => {
    setChecked(initialChecked);
    setSubmitState({ phase: "idle" });
  }, [initialChecked]);

  const toggle = (idx: number): void => {
    setChecked((prev) => {
      const next = new Map(prev);
      next.set(idx, !next.get(idx));
      return next;
    });
  };

  const acceptedRows = rows.filter((r) => checked.get(r.sourceRowIndex));
  const isSubmitting = submitState.phase === "submitting";

  const submit = async (): Promise<void> => {
    setSubmitState({ phase: "submitting" });
    try {
      const result = await onCommit(acceptedRows);
      setSubmitState({
        phase: "success",
        committed: result.committed,
        skipped: rows.length - acceptedRows.length,
        alreadyPresent: result.alreadyPresent ?? 0,
        failedChunks: result.failedChunks,
      });
    } catch (err) {
      setSubmitState({
        phase: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-modal-title"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-lg shadow-xl"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <header
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h2
              id="preview-modal-title"
              className="text-lg font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {submitState.phase === "success"
                ? t("settings:import.preview.success.title")
                : t("settings:import.preview.title")}
            </h2>
            {submitState.phase !== "success" && (
              <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
                {t("settings:import.preview.summary", {
                  ok: summary.ok,
                  duplicates: summary.duplicates,
                  problems: summary.problems,
                })}
                {summary.unresolvable > 0 && ` · ${summary.unresolvable} unresolvable`}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-2xl leading-none disabled:opacity-50"
            style={{ color: "var(--text-muted)" }}
            aria-label={t("settings:import.preview.success.close")}
          >
            ×
          </button>
        </header>

        {submitState.phase === "success" ? (
          <SuccessView
            committed={submitState.committed}
            skipped={submitState.skipped}
            alreadyPresent={submitState.alreadyPresent}
            failedChunks={submitState.failedChunks}
            flightsListHref={flightsListHref}
            onClose={onClose}
            t={t}
          />
        ) : (
          <RowsView
            rows={rows}
            checked={checked}
            toggle={toggle}
            isSubmitting={isSubmitting}
            t={t}
          />
        )}

        {submitState.phase !== "success" && (
          <footer
            className="flex flex-wrap items-center justify-end gap-2 border-t px-6 py-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            {submitState.phase === "error" && (
              <p className="mr-auto text-sm" style={{ color: "rgb(252, 165, 165)" }}>
                {submitState.message}
              </p>
            )}
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-50"
              style={{ background: "var(--bg-elevated)" }}
            >
              {t("settings:import.preview.cancel")}
            </button>
            <button
              onClick={() => void submit()}
              disabled={acceptedRows.length === 0 || isSubmitting}
              className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50"
            >
              {isSubmitting
                ? t("settings:import.preview.submitting")
                : t("settings:import.preview.commit", { count: acceptedRows.length })}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

interface RowsViewProps {
  rows: PreviewRowEnriched[];
  checked: Map<number, boolean>;
  toggle: (idx: number) => void;
  isSubmitting: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function RowsView({ rows, checked, toggle, isSubmitting, t }: RowsViewProps): JSX.Element {
  return (
    <div className="overflow-auto px-6 py-4">
      <table className="w-full text-sm">
        <thead
          className="sticky top-0 z-10 text-left"
          style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}
        >
          <tr>
            <th className="w-8 py-2" />
            <th className="py-2 pr-3">{t("settings:import.preview.columns.date")}</th>
            <th className="py-2 pr-3">{t("settings:import.preview.columns.route")}</th>
            <th className="py-2 pr-3">{t("settings:import.preview.columns.flight")}</th>
            <th className="py-2 pr-3">{t("settings:import.preview.columns.status")}</th>
            <th className="py-2">{t("settings:import.preview.columns.flags")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const hardError = hasHardError(r.flags);
            const warnings = r.flags.filter(isWarningFlag);
            const errors = r.flags.filter((f) => !isWarningFlag(f));
            const isDup = r.dedupeHint !== "none";
            return (
              <tr
                key={r.sourceRowIndex}
                className="border-t"
                style={{
                  borderColor: "var(--color-border)",
                  background: hardError
                    ? "rgba(239, 68, 68, 0.08)"
                    : warnings.length > 0
                      ? "rgba(245, 158, 11, 0.08)"
                      : isDup
                        ? "rgba(245, 158, 11, 0.05)"
                        : "transparent",
                }}
              >
                <td className="py-2">
                  <input
                    type="checkbox"
                    aria-label={t("settings:import.preview.rowAriaLabel", {
                      index: r.sourceRowIndex,
                    })}
                    checked={!!checked.get(r.sourceRowIndex)}
                    disabled={hardError || isSubmitting}
                    onChange={() => toggle(r.sourceRowIndex)}
                  />
                </td>
                <td className="py-2 pr-3" style={{ color: "var(--text-primary)" }}>
                  {hardError ? "—" : formatDate(r.depUtc)}
                </td>
                <td className="py-2 pr-3" style={{ color: "var(--text-primary)" }}>
                  {r.fromIata} → {r.toIata}
                </td>
                <td className="py-2 pr-3" style={{ color: "var(--text-primary)" }}>
                  {r.flightNumberNormalised ?? r.flightNumber ?? "—"}
                </td>
                <td className="py-2 pr-3" style={{ color: "var(--text-primary)" }}>
                  {hardError ? "—" : r.statusDefault}
                </td>
                <td className="flex flex-wrap gap-1 py-2">
                  {errors.map((f) => (
                    <span
                      key={f}
                      title={t(`settings:import.preview.errorBadge.${f}`)}
                      className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs"
                      style={{
                        background: "rgba(239, 68, 68, 0.18)",
                        color: "rgb(252, 165, 165)",
                      }}
                    >
                      {t(`settings:import.preview.errorBadge.${f}`)}
                    </span>
                  ))}
                  {warnings.map((f) => (
                    <span
                      key={f}
                      title={t(`settings:import.preview.warningBadge.${f}`)}
                      className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs"
                      style={{
                        background: "rgba(245, 158, 11, 0.18)",
                        color: "rgb(252, 211, 77)",
                      }}
                    >
                      {t(`settings:import.preview.warningBadge.${f}`)}
                    </span>
                  ))}
                  {isDup && (
                    <span
                      className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs"
                      style={{
                        background: "rgba(245, 158, 11, 0.12)",
                        color: "rgb(252, 211, 77)",
                      }}
                    >
                      {t(`settings:import.preview.dedupeBadge.${r.dedupeHint}`, {
                        defaultValue: r.dedupeHint,
                      })}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface SuccessViewProps {
  committed: number;
  /** Rows the user unticked in the preview. */
  skipped: number;
  /** Rows the server already had from an earlier import. */
  alreadyPresent: number;
  failedChunks: number;
  flightsListHref?: string;
  onClose: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function SuccessView({
  committed,
  skipped,
  alreadyPresent,
  failedChunks,
  flightsListHref,
  onClose,
  t,
}: SuccessViewProps): JSX.Element {
  return (
    <>
      <div className="px-6 py-8" style={{ color: "var(--text-primary)" }}>
        <p className="text-lg font-medium">
          {t("settings:import.preview.success.imported", { count: committed })}
        </p>
        {alreadyPresent > 0 && (
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("settings:import.preview.success.alreadyPresent", { count: alreadyPresent })}
          </p>
        )}
        {skipped > 0 && (
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("settings:import.preview.success.skipped", { count: skipped })}
          </p>
        )}
        {failedChunks > 0 && (
          <p className="mt-2 text-sm" style={{ color: "rgb(252, 165, 165)" }}>
            {t("settings:import.preview.success.failed", { count: failedChunks })}
          </p>
        )}
      </div>
      <footer
        className="flex flex-wrap items-center justify-end gap-2 border-t px-6 py-4"
        style={{ borderColor: "var(--color-border)" }}
      >
        {flightsListHref && (
          <a
            href={flightsListHref}
            className="btn-secondary px-3 py-1.5 text-sm"
            style={{ background: "var(--bg-elevated)" }}
          >
            {t("settings:import.preview.success.openFlights")}
          </a>
        )}
        <button onClick={onClose} className="btn-primary px-4 py-1.5 text-sm">
          {t("settings:import.preview.success.close")}
        </button>
      </footer>
    </>
  );
}
