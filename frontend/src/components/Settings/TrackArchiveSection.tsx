/**
 * Recordings out as files and back in (2.7).
 *
 * The spreadsheet carries tours as rows — name, activity, points — but not
 * what was recorded on them, so a spreadsheet alone moves a tour without its
 * line. This section is the other half: every recording as a GPX file in one
 * ZIP, and GPX, TCX, FIT or ZIP files read back. Our own files carry the
 * measured figures and land on their tour again; anyone else's file becomes a
 * day tour of its own.
 *
 * Reading in previews first and writes only on confirmation, as the
 * spreadsheet import does — a ZIP can hold hundreds of recordings.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  TrackArchiveTooLarge,
  trackArchiveApi,
  type TrackArchiveImportResult,
} from "../../lib/api/trackArchive";
import { downloadBlob } from "../../lib/export";
import { useToursVisible } from "../../hooks/useToursVisible";
import { Icon } from "../ui/Icon";
import { SettingRow } from "../ui/SettingRow";

type ExportStatus = "idle" | "running" | "failed";
type ImportStatus =
  "idle" | "checking" | "previewed" | "applying" | "applied" | "failed" | "tooLarge";

/** How many file lines the preview lists before it only counts. */
const LISTED_FILES = 20;

export default function TrackArchiveSection(): JSX.Element | null {
  const { t } = useTranslation(["roadtrips", "common"]);
  // Tours and roadtrips sit behind the beta switch; so do their files.
  const toursVisible = useToursVisible();
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [importStatus, setImportStatus] = useState<ImportStatus>("idle");
  const [result, setResult] = useState<TrackArchiveImportResult | null>(null);
  /** Held for the confirm step, so applying sends exactly what was previewed. */
  const [pending, setPending] = useState<File[]>([]);

  const handleExport = useCallback(async () => {
    setExportStatus("running");
    try {
      const file = await trackArchiveApi.downloadAll();
      downloadBlob(file.blob, file.filename);
      setExportStatus("idle");
    } catch {
      setExportStatus("failed");
    }
  }, []);

  const run = useCallback(async (files: File[], dryRun: boolean) => {
    setImportStatus(dryRun ? "checking" : "applying");
    try {
      const outcome = await trackArchiveApi.importFiles(files, dryRun);
      setResult(outcome);
      setImportStatus(dryRun ? "previewed" : "applied");
    } catch (err) {
      setImportStatus(err instanceof TrackArchiveTooLarge ? "tooLarge" : "failed");
    }
  }, []);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      const files = list ? Array.from(list) : [];
      if (files.length === 0) return;
      setPending(files);
      setResult(null);
      void run(files, true);
    },
    [run]
  );

  const reset = useCallback(() => {
    setImportStatus("idle");
    setResult(null);
    setPending([]);
  }, []);

  const files = result?.files ?? [];
  const count = (action: string) => files.filter((f) => f.action === action).length;
  const writable = count("attach") + count("createTour");
  const busy = importStatus === "checking" || importStatus === "applying";

  if (!toursVisible) return null;

  return (
    <>
      <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
        <SettingRow
          title={t("roadtrips:trackArchive.exportTitle")}
          sub={t("roadtrips:trackArchive.exportDescription")}
          control={
            <button
              type="button"
              onClick={handleExport}
              disabled={exportStatus === "running"}
              className="btn-secondary inline-flex items-center gap-2"
            >
              <Icon name="download" size={14} />
              {exportStatus === "running"
                ? t("roadtrips:trackArchive.exportRunning")
                : t("roadtrips:trackArchive.exportButton")}
            </button>
          }
        />
        {exportStatus === "failed" && (
          <p className="t-caption" style={{ color: "var(--ts-bad)" }}>
            {t("roadtrips:trackArchive.exportFailed")}
          </p>
        )}
      </div>

      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <SettingRow
          title={t("roadtrips:trackArchive.importTitle")}
          sub={t("roadtrips:trackArchive.importDescription")}
          control={
            <label className="btn-secondary inline-flex cursor-pointer items-center gap-2">
              <Icon name="upload" size={14} />
              {importStatus === "checking"
                ? t("roadtrips:trackArchive.checking")
                : t("roadtrips:trackArchive.choose")}
              <input
                type="file"
                multiple
                accept=".gpx,.tcx,.fit,.zip"
                className="sr-only"
                aria-label={t("roadtrips:trackArchive.choose")}
                disabled={busy}
                onChange={(e) => {
                  handleFiles(e.target.files);
                  // Clear it, so choosing the SAME file again still fires.
                  e.target.value = "";
                }}
              />
            </label>
          }
        />

        {result && (
          <div className="space-y-2 text-xs">
            <p style={{ color: "var(--text-muted)" }}>
              {importStatus === "applied"
                ? t("roadtrips:trackArchive.applied")
                : t("roadtrips:trackArchive.preview")}
            </p>
            <p>
              {t("roadtrips:trackArchive.counts", {
                attach: count("attach"),
                createTour: count("createTour"),
                duplicate: count("duplicate"),
                error: count("error"),
              })}
            </p>
            <ul className="space-y-1">
              {files.slice(0, LISTED_FILES).map((f, i) => (
                <li
                  key={`${f.file}-${i}`}
                  style={f.action === "error" ? { color: "var(--ts-bad)" } : undefined}
                >
                  <span className="font-medium">{f.file}</span>
                  {" — "}
                  {f.action === "error"
                    ? t(`roadtrips:trackArchive.errors.${f.message ?? "unreadable"}`, {
                        name: f.tourName ?? "",
                      })
                    : t(`roadtrips:trackArchive.actions.${f.action}`, { name: f.tourName ?? "" })}
                </li>
              ))}
            </ul>
            {files.length > LISTED_FILES && (
              <p style={{ color: "var(--text-muted)" }}>
                {t("roadtrips:trackArchive.more", { count: files.length - LISTED_FILES })}
              </p>
            )}

            {importStatus === "previewed" && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void run(pending, false)}
                  disabled={writable === 0}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  {t("roadtrips:trackArchive.apply", { count: writable })}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-md border border-[var(--border)] px-3 py-2 text-sm"
                >
                  {t("common:buttons.cancel")}
                </button>
              </div>
            )}
          </div>
        )}

        {importStatus === "failed" && (
          <p className="text-xs" style={{ color: "var(--ts-bad)" }}>
            {t("roadtrips:trackArchive.failed")}
          </p>
        )}
        {importStatus === "tooLarge" && (
          <p className="text-xs" style={{ color: "var(--ts-bad)" }}>
            {t("roadtrips:trackArchive.tooLarge")}
          </p>
        )}
      </div>
    </>
  );
}
