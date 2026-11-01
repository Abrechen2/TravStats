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
import { railApi } from "../../lib/api/rail";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { tourIndexApi } from "../../lib/api/tourIndex";
import { toursApi } from "../../lib/api/tours";
import { useToursVisible } from "../../hooks/useToursVisible";
import { exportFilename, exportWorkbook } from "../../lib/xlsx/exportAll";
import {
  ImportRefused,
  readWorkbookForImport,
  sendImport,
  type ImportMode,
  type ImportOutcome,
  type SheetOutcome,
} from "../../lib/xlsx/importClient";
import type { ParsedSheet } from "../../lib/xlsx/workbook";
import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { busApi } from "../../lib/api/bus";
import { ferryApi } from "../../lib/api/ferry";
import { rentalApi } from "../../lib/api/rental";
import { Icon } from "../ui/Icon";
import { ConfirmDialog, ErrorLine, SettingItem } from "../ui/settings";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useDialogCopy, useRowCopy } from "./rowCopy";
import { useDomainVisible } from "../../hooks/useDomainVisible";

/** The languages a TravStats export can be written in. */
const WORKBOOK_LANGUAGES = ["de", "en"] as const;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Per row: new or changed, and how an existing entry was found. The counts
 * alone cannot say WHICH hotel is about to be created twice — this can, and
 * it is what a person checks before moving a file into another account.
 */
export function SheetRows({ sheet, t }: { sheet: SheetOutcome; t: Translate }): JSX.Element | null {
  const rows = sheet.rows.filter((r) => r.action !== "error");
  if (rows.length === 0) return null;
  return (
    <details className="ml-3">
      <summary className="cursor-pointer" style={{ color: "var(--text-muted)" }}>
        {t("xlsx:import.rowsToggle")}
      </summary>
      <ul className="mt-1 space-y-0.5">
        {rows.map((r) => (
          <li key={r.row} data-testid={`xlsx-row-${sheet.key}-${r.row}`}>
            <span className="font-medium">{t(`xlsx:import.actions.${r.action}`)}</span>{" "}
            {t("xlsx:import.rowLine", { row: r.row, label: r.label })}
            {r.message && (
              <span style={{ color: "var(--text-muted)" }}>
                {" "}
                · {t(`xlsx:import.resolution.${r.message}`, { defaultValue: r.message })}
              </span>
            )}
            {(r.notes ?? []).map((n) => (
              <span key={n} style={{ color: "var(--text-muted)" }}>
                {" "}
                · {t(`xlsx:import.notes.${n}`, { defaultValue: n })}
              </span>
            ))}
            {(r.dropped ?? []).map((d) => (
              <span key={`dropped-${d.field}`} style={{ color: "var(--text-muted)" }}>
                {" "}
                ·{" "}
                {t(d.kept ? "xlsx:import.droppedValueKept" : "xlsx:import.droppedValue", {
                  field: t(`xlsx:columns.${d.field}`, { defaultValue: d.field }),
                  value: d.value,
                })}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </details>
  );
}

type Status = "idle" | "running" | "empty" | "failed";
type ImportStatus =
  | "idle"
  | "checking"
  | "previewed"
  | "applying"
  | "applied"
  | "failed"
  | "backupFailed"
  | "backupRunning"
  | "outcomeUnknown"
  | "nothing";

/** Sheets held for the confirm step, so applying re-sends exactly what was
 *  previewed rather than re-reading a file that may have changed on disk. */
type Pending = ParsedSheet[];

export default function SpreadsheetSection({
  part = "both",
}: {
  /** The page draws the export under "Mitnehmen" and the import under "Einlesen". */
  part?: "export" | "import" | "both";
}): JSX.Element {
  const { t, i18n } = useTranslation(["xlsx", "common", "settings", "settingsRows"]);
  const row = useRowCopy("data");
  const dialog = useDialogCopy();
  const isDemo = useIsDemoAccount();
  const [askReplace, setAskReplace] = useState(false);
  const [fileName, setFileName] = useState("");
  const { isEnabled } = useEnabledDomains();
  // Rail, rentals, bus and ferry follow the user's domain choice: with one off
  // the export carries no sheet for it (forgejo#267, forgejo#180).
  const railVisible = useDomainVisible("rail");
  const rentalVisible = useDomainVisible("rental");
  const busVisible = useDomainVisible("bus");
  const ferryVisible = useDomainVisible("ferry");
  const toursVisible = useToursVisible();
  const [status, setStatus] = useState<Status>("idle");

  const handleExport = useCallback(async () => {
    setStatus("running");
    try {
      // Only domains this instance actually runs. Asking the cruise endpoint
      // on an instance with cruises switched off would 404 and fail the whole
      // export over data the user does not have.
      const [flights, cruises, lodging, places, roadtrips, tours, rail, rentals, bus, ferry] =
        await Promise.all([
          // Walked page by page, like the other domains. One "large" page was
          // never enough: the server caps `limit` at 500 whatever is asked for,
          // so an account with 501 flights exported 500 of them and said
          // nothing (beta audit 2026-09-20, SRV-EXPORT-002).
          isEnabled("flight") ? flightsApi.getEvery() : Promise.resolve([]),
          isEnabled("cruise") ? cruiseApi.list() : Promise.resolve([]),
          isEnabled("lodging") ? listLodgings() : Promise.resolve([]),
          isEnabled("poi") ? placesApi.list() : Promise.resolve([]),
          // A station sheet needs every station, which only the detail carries.
          isEnabled("roadtrip")
            ? roadtripsApi
                .list()
                .then((rows) => Promise.all(rows.map((r) => roadtripsApi.get(r.id))))
            : Promise.resolve([]),
          // The points sheet needs every tour's points, which only the detail carries.
          toursVisible
            ? tourIndexApi.list("tour").then((rows) =>
                Promise.all(
                  rows.map(async (r) => ({
                    ...r,
                    points: (await toursApi.get(undefined, r.id)).stops,
                  }))
                )
              )
            : Promise.resolve([]),
          railVisible ? railApi.listAll() : Promise.resolve([]),
          rentalVisible ? rentalApi.listAll() : Promise.resolve([]),
          busVisible ? busApi.listAll() : Promise.resolve([]),
          ferryVisible ? ferryApi.listAll() : Promise.resolve([]),
        ]);

      const blob = await exportWorkbook(
        t,
        { flights, cruises, lodging, places, roadtrips, tours, rail, rentals, bus, ferry },
        i18n.language
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
  }, [
    isEnabled,
    toursVisible,
    railVisible,
    rentalVisible,
    busVisible,
    ferryVisible,
    t,
    i18n.language,
  ]);

  const [importStatus, setImportStatus] = useState<ImportStatus>("idle");
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pending, setPending] = useState<Pending>([]);
  /** Defaults to the non-destructive middle option, never to `replace`. */
  const [mode, setMode] = useState<ImportMode>("merge");

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setFileName(file.name);
      setImportStatus("checking");
      setOutcome(null);
      try {
        // A file exported in the other language is read too (forgejo#175).
        const otherLanguages = WORKBOOK_LANGUAGES.filter((lng) => lng !== i18n.language).map(
          (lng) => i18n.getFixedT(lng, ["xlsx", "common"])
        );
        const sheets = await readWorkbookForImport(
          t,
          file,
          { rail: railVisible, bus: busVisible, ferry: ferryVisible, rental: rentalVisible },
          otherLanguages
        );
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
    [t, mode, railVisible, busVisible, ferryVisible, rentalVisible]
  );

  const handleApply = useCallback(async () => {
    setAskReplace(false);
    setImportStatus("applying");
    try {
      const result = await sendImport(pending, false, mode);
      setOutcome(result);
      setImportStatus("applied");
    } catch (err) {
      // A refused safety backup is not a broken file — saying so would send
      // the user to inspect a spreadsheet that is perfectly fine.
      setImportStatus(err instanceof ImportRefused && err.kind !== "unknown" ? err.kind : "failed");
    }
  }, [pending, mode]);

  const reset = useCallback(() => {
    setImportStatus("idle");
    setOutcome(null);
    setPending([]);
    setAskReplace(false);
  }, []);

  const errorRows = (outcome?.sheets ?? []).flatMap((s) =>
    s.rows.filter((r) => r.action === "error").map((r) => ({ ...r, sheet: s.key }))
  );
  /** Rows that would be removed — the part of a replace the sheet cannot show. */
  const deletionCount = (outcome?.sheets ?? []).reduce((n, s) => n + s.deleted, 0);
  const needsConfirmation = mode === "replace" && deletionCount > 0;
  const mayApply = Boolean(outcome?.clean);
  /** Sheets the file holds rows for: the ones a replace rewrites (design R21). */
  const touched = (outcome?.sheets ?? []).filter(
    (s) => s.created + s.updated + s.skipped + s.errors + s.deleted > 0
  );
  const fromFile = touched.reduce((n, s) => n + s.created + s.updated + s.skipped, 0);

  const exportCopy = row("excelexp");
  const importCopy = row("excelimp");
  const lock = isDemo
    ? { why: "demo" as const, reason: t("settings:blocks.lock.demo") }
    : undefined;
  const replace = dialog("replace", {
    sheets: touched.map((x) => t(`xlsx:sheets.${x.key}`)).join(", "),
    missing: deletionCount,
    kept: fromFile,
    file: fileName,
  });

  return (
    <>
      {part !== "import" && (
        <SettingItem
          title={exportCopy.title}
          sub={exportCopy.sub}
          help={exportCopy.help}
          error={status === "failed" ? t("xlsx:export.failed") : undefined}
          control={
            <button
              type="button"
              onClick={handleExport}
              disabled={status === "running"}
              className="btn-secondary inline-flex items-center gap-2"
            >
              <Icon name="download" size={14} />
              {status === "running"
                ? t("xlsx:export.running")
                : (exportCopy.btn ?? t("xlsx:export.button"))}
            </button>
          }
        >
          {status === "empty" && <p className="t-caption">{t("xlsx:export.empty")}</p>}
        </SettingItem>
      )}

      {part !== "export" && (
        <SettingItem
          title={importCopy.title}
          sub={importCopy.sub}
          help={importCopy.help}
          locked={lock}
          control={
            <label
              className="btn-secondary inline-flex cursor-pointer items-center gap-2"
              aria-disabled={isDemo || undefined}
            >
              <Icon name="upload" size={14} />
              {importStatus === "checking"
                ? t("xlsx:import.checking")
                : (importCopy.btn ?? t("xlsx:import.choose"))}
              <input
                type="file"
                accept=".xlsx"
                className="sr-only"
                disabled={isDemo || importStatus === "checking" || importStatus === "applying"}
                onChange={(e) => {
                  void handleFile(e.target.files?.[0]);
                  // Clear it, so choosing the SAME file again after a fix still fires.
                  e.target.value = "";
                }}
              />
            </label>
          }
        >
          {/* Radios with their hints kept visible, not pills: one of the three
            deletes, and that sentence must be read before choosing. */}
          <fieldset className="border-0 p-0">
            <legend className="label">{t("xlsx:import.modeLabel")}</legend>
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
                    <span className="t-caption block">{t(`xlsx:import.modes.${m}.hint`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {outcome && (
            <div className="space-y-2 text-xs">
              <p style={{ color: "var(--text-muted)" }}>
                {importStatus === "applied" ? t("xlsx:import.applied") : t("xlsx:import.preview")}
              </p>
              {outcome.sheets.map((s) => (
                <div key={s.key}>
                  <div className="flex items-baseline gap-2">
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
                  <SheetRows sheet={s} t={t} />
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
                        message: t(`xlsx:import.errors.${r.message}`, {
                          defaultValue: r.message ?? "",
                        }),
                      })}
                    </p>
                  ))}
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
                    onClick={() => (needsConfirmation ? setAskReplace(true) : void handleApply())}
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

          {importStatus === "nothing" && <p className="t-caption">{t("xlsx:import.nothing")}</p>}
          {(
            [
              ["failed", "xlsx:import.failed"],
              ["backupFailed", "xlsx:import.backupFailed"],
              ["backupRunning", "xlsx:import.backupRunning"],
              ["outcomeUnknown", "xlsx:import.outcomeUnknown"],
            ] as const
          ).map(([state, key]) =>
            importStatus === state ? <ErrorLine key={state}>{t(key)}</ErrorLine> : null
          )}
        </SettingItem>
      )}
      <ConfirmDialog
        open={askReplace}
        {...replace}
        busy={importStatus === "applying"}
        onConfirm={() => void handleApply()}
        onCancel={() => setAskReplace(false)}
      />
    </>
  );
}
