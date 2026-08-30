/**
 * The Excel export, reachable.
 *
 * There has been a working flight exporter in `lib/xlsxRoundTrip.ts` since
 * long before this — tested, and with no caller anywhere in the app, so from
 * the outside TravStats simply had no Excel export. This section is what makes
 * the capability exist for a user.
 *
 * The data is fetched here, on the click, rather than held in a store: an
 * export is rare, and pre-loading every cruise, property and place on the
 * chance someone might want a spreadsheet would cost every page load.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { cruiseApi } from "../../lib/api/cruise";
import { flightsApi } from "../../lib/api/flights";
import { listLodgings } from "../../lib/api/lodging";
import { placesApi } from "../../lib/api/places";
import { exportFilename, exportWorkbook } from "../../lib/xlsx/exportAll";
import {
  ImportRefused,
  readWorkbookForImport,
  sendImport,
  type ImportMode,
  type ImportOutcome,
} from "../../lib/xlsx/importClient";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";

type Status = "idle" | "running" | "empty" | "failed";
type ImportStatus =
  | "idle"
  | "checking"
  | "previewed"
  | "applying"
  | "applied"
  | "failed"
  | "backupFailed"
  | "nothing";

/** Sheets held for the confirm step, so applying re-sends exactly what was
 *  previewed rather than re-reading a file that may have changed on disk. */
type Pending = { key: string; rows: Record<string, string>[] }[];

export default function SpreadsheetSection(): JSX.Element {
  const { t, i18n } = useTranslation(["xlsx", "common"]);
  const { isEnabled } = useEnabledDomains();
  const [status, setStatus] = useState<Status>("idle");

  const handleExport = useCallback(async () => {
    setStatus("running");
    try {
      // Only domains this instance actually runs. Asking the cruise endpoint
      // on an instance with cruises switched off would 404 and fail the whole
      // export over data the user does not have.
      const [flights, cruises, lodging, places] = await Promise.all([
        // The list endpoint pages; one large page is enough for an export and
        // keeps this to a single request.
        isEnabled("flight")
          ? flightsApi.getAll({ limit: 5000, offset: 0 }).then((r) => r.flights)
          : Promise.resolve([]),
        isEnabled("cruise") ? cruiseApi.list() : Promise.resolve([]),
        isEnabled("lodging") ? listLodgings() : Promise.resolve([]),
        isEnabled("poi") ? placesApi.list() : Promise.resolve([]),
      ]);

      const blob = await exportWorkbook(
        t,
        { flights, cruises, lodging, places },
        i18n.language,
      );
      if (!blob) {
        setStatus("empty");
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFilename(t, new Date());
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking immediately can cancel the download in some browsers; one
      // tick is enough for the click to have been taken.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  }, [isEnabled, t, i18n.language]);

  const [importStatus, setImportStatus] = useState<ImportStatus>("idle");
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pending, setPending] = useState<Pending>([]);
  /** Defaults to the non-destructive middle option, never to `replace`. */
  const [mode, setMode] = useState<ImportMode>("merge");
  /** The extra tick `replace` demands. Reset on every new preview so it can
   *  never carry over from a file the user already dismissed. */
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setImportStatus("checking");
      setOutcome(null);
      try {
        const sheets = await readWorkbookForImport(t, file);
        if (sheets.length === 0) {
          setImportStatus("nothing");
          return;
        }
        // Preview first, always. An import can rewrite hundreds of rows.
        const result = await sendImport(sheets, true, mode);
        setPending(sheets);
        setOutcome(result);
        setImportStatus("previewed");
      } catch {
        setImportStatus("failed");
      }
    },
    [t, mode],
  );

  const handleApply = useCallback(async () => {
    setImportStatus("applying");
    try {
      const result = await sendImport(pending, false, mode);
      setOutcome(result);
      setImportStatus("applied");
    } catch (err) {
      // A refused safety backup is not a broken file — saying so would send
      // the user to inspect a spreadsheet that is perfectly fine.
      setImportStatus(
        err instanceof ImportRefused && err.kind === "backupFailed" ? "backupFailed" : "failed",
      );
    }
  }, [pending, mode]);

  const reset = useCallback(() => {
    setImportStatus("idle");
    setOutcome(null);
    setPending([]);
    setReplaceConfirmed(false);
  }, []);

  const errorRows = (outcome?.sheets ?? []).flatMap((s) =>
    s.rows.filter((r) => r.action === "error").map((r) => ({ ...r, sheet: s.key })),
  );
  /** Rows that would be removed — the part of a replace the sheet cannot show. */
  const deletionCount = (outcome?.sheets ?? []).reduce((n, s) => n + s.deleted, 0);
  const needsConfirmation = mode === "replace" && deletionCount > 0;
  const mayApply = Boolean(outcome?.clean) && (!needsConfirmation || replaceConfirmed);

  return (
    <>
    <section className="rounded-lg border border-[var(--border)] p-4">
      <h3 className="mb-1 text-sm font-semibold">{t("xlsx:export.button")}</h3>
      <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("xlsx:export.description")}
      </p>

      <button
        type="button"
        onClick={handleExport}
        disabled={status === "running"}
        className="rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60"
        style={{ background: "var(--accent)", color: "#0b0f14" }}
      >
        {status === "running" ? t("xlsx:export.running") : t("xlsx:export.button")}
      </button>

      {status === "empty" && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("xlsx:export.empty")}
        </p>
      )}
      {status === "failed" && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger, #f87171)" }}>
          {t("xlsx:export.failed")}
        </p>
      )}
    </section>

    <section className="rounded-lg border border-[var(--border)] p-4">
      <h3 className="mb-1 text-sm font-semibold">{t("xlsx:import.title")}</h3>
      <p className="mb-1 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("xlsx:import.description")}
      </p>
      {/* Named rather than left to be discovered: editing a sheet and watching
          nothing happen is worse than knowing beforehand that it is read-only. */}
      <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("xlsx:import.readOnlySheets")}
      </p>

      <fieldset className="mb-3 border-0 p-0">
        <legend className="mb-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("xlsx:import.modeLabel")}
        </legend>
        <div className="flex flex-col gap-1.5">
          {(["add", "merge", "replace"] as const).map((m) => (
            <label key={m} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="xlsx-import-mode"
                value={m}
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  // A preview belongs to the mode it was made in — keep it and
                  // the user could apply "replace" after previewing "merge".
                  reset();
                }}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{t(`xlsx:import.modes.${m}.label`)}</span>
                <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                  {t(`xlsx:import.modes.${m}.hint`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="inline-block cursor-pointer rounded-md border border-[var(--border)] px-3 py-2 text-sm">
        {importStatus === "checking" ? t("xlsx:import.checking") : t("xlsx:import.choose")}
        <input
          type="file"
          accept=".xlsx"
          className="hidden"
          disabled={importStatus === "checking" || importStatus === "applying"}
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            // Clear it, so choosing the SAME file again after a fix still fires.
            e.target.value = "";
          }}
        />
      </label>

      {outcome && (
        <div className="mt-3 space-y-2 text-xs">
          <p style={{ color: "var(--text-muted)" }}>
            {importStatus === "applied" ? t("xlsx:import.applied") : t("xlsx:import.preview")}
          </p>
          {outcome.sheets.map((s) => (
            <div key={s.key} className="flex items-baseline gap-2">
              <span className="font-medium">{t(`xlsx:sheets.${s.key}`)}</span>
              <span style={{ color: "var(--text-muted)" }}>
                {t("xlsx:import.counts", {
                  created: s.created,
                  updated: s.updated,
                  skipped: s.skipped,
                  errors: s.errors,
                })}
              </span>
            </div>
          ))}

          {errorRows.length > 0 && (
            <div className="mt-2 space-y-1" style={{ color: "var(--danger, #f87171)" }}>
              <p>{t("xlsx:import.hasErrors")}</p>
              {errorRows.slice(0, 10).map((r) => (
                <p key={`${r.sheet}-${r.row}`}>
                  {t("xlsx:import.rowError", {
                    row: r.row,
                    label: r.label,
                    message: t(`xlsx:import.errors.${r.message}`, { defaultValue: r.message ?? "" }),
                  })}
                </p>
              ))}
            </div>
          )}

          {needsConfirmation && importStatus === "previewed" && (
            <div
              className="mt-3 rounded-md p-3"
              style={{
                border: "1px solid var(--danger, #f87171)",
                background: "color-mix(in srgb, var(--danger, #f87171) 8%, transparent)",
              }}
            >
              <p className="font-medium" style={{ color: "var(--danger, #f87171)" }}>
                {t("xlsx:import.replaceWarningTitle")}
              </p>
              <p className="mt-1" style={{ color: "var(--text-muted)" }}>
                {t("xlsx:import.replaceWarning")}
              </p>
              <p className="mt-2 font-medium" style={{ color: "var(--danger, #f87171)" }}>
                {t("xlsx:import.willDelete", { count: deletionCount })}
              </p>
              <label className="mt-2 flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={replaceConfirmed}
                  onChange={(e) => setReplaceConfirmed(e.target.checked)}
                  className="mt-1"
                />
                <span>{t("xlsx:import.confirmReplace", { count: deletionCount })}</span>
              </label>
            </div>
          )}

          {importStatus === "applied" && outcome.backupId && (
            <p style={{ color: "var(--text-muted)" }}>
              {t("xlsx:import.backupTaken", { id: outcome.backupId })}
            </p>
          )}

          {importStatus === "previewed" && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleApply}
                disabled={!mayApply}
                className="rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#0b0f14" }}
              >
                {t("xlsx:import.apply")}
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
              >
                {t("xlsx:import.cancel")}
              </button>
            </div>
          )}
        </div>
      )}

      {importStatus === "nothing" && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("xlsx:import.nothing")}
        </p>
      )}
      {importStatus === "failed" && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger, #f87171)" }}>
          {t("xlsx:import.failed")}
        </p>
      )}
      {importStatus === "backupFailed" && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger, #f87171)" }}>
          {t("xlsx:import.backupFailed")}
        </p>
      )}
    </section>
    </>
  );
}
