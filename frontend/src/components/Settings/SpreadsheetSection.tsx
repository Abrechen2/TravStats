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
import { listLodgings } from "../../lib/api/lodging";
import { placesApi } from "../../lib/api/places";
import { exportFilename, exportWorkbook } from "../../lib/xlsx/exportAll";
import {
  readWorkbookForImport,
  sendImport,
  type ImportOutcome,
} from "../../lib/xlsx/importClient";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";

type Status = "idle" | "running" | "empty" | "failed";
type ImportStatus = "idle" | "checking" | "previewed" | "applying" | "applied" | "failed" | "nothing";

/** Sheets held for the confirm step, so applying re-sends exactly what was
 *  previewed rather than re-reading a file that may have changed on disk. */
type Pending = { key: string; rows: Record<string, string>[] }[];

export default function SpreadsheetSection(): JSX.Element {
  const { t } = useTranslation(["xlsx", "common"]);
  const { isEnabled } = useEnabledDomains();
  const [status, setStatus] = useState<Status>("idle");

  const handleExport = useCallback(async () => {
    setStatus("running");
    try {
      // Only domains this instance actually runs. Asking the cruise endpoint
      // on an instance with cruises switched off would 404 and fail the whole
      // export over data the user does not have.
      const [cruises, lodging, places] = await Promise.all([
        isEnabled("cruise") ? cruiseApi.list() : Promise.resolve([]),
        isEnabled("lodging") ? listLodgings() : Promise.resolve([]),
        isEnabled("poi") ? placesApi.list() : Promise.resolve([]),
      ]);

      const blob = await exportWorkbook(t, { cruises, lodging, places });
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
  }, [isEnabled, t]);

  const [importStatus, setImportStatus] = useState<ImportStatus>("idle");
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pending, setPending] = useState<Pending>([]);

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
        const result = await sendImport(sheets, true);
        setPending(sheets);
        setOutcome(result);
        setImportStatus("previewed");
      } catch {
        setImportStatus("failed");
      }
    },
    [t],
  );

  const handleApply = useCallback(async () => {
    setImportStatus("applying");
    try {
      const result = await sendImport(pending, false);
      setOutcome(result);
      setImportStatus("applied");
    } catch {
      setImportStatus("failed");
    }
  }, [pending]);

  const reset = useCallback(() => {
    setImportStatus("idle");
    setOutcome(null);
    setPending([]);
  }, []);

  const errorRows = (outcome?.sheets ?? []).flatMap((s) =>
    s.rows.filter((r) => r.action === "error").map((r) => ({ ...r, sheet: s.key })),
  );

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
      <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("xlsx:import.description")}
      </p>

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

          {importStatus === "previewed" && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleApply}
                disabled={!outcome.clean}
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
    </section>
    </>
  );
}
