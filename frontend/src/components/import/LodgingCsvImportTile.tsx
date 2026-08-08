import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";
import { parseCsv } from "../../lib/csvParser";
import {
  buildLodgingCandidates,
  buildLodgingMappingFields,
  type LodgingCsvField,
  type LodgingCsvMapping,
} from "../../lib/importers/lodgingCsv";
import {
  commitLodgingImport,
  previewLodgingImport,
  suggestLodgingCsvMapping,
} from "../../lib/api/lodgingImport";
import {
  describeLodgingCommitResult,
  describeLodgingRowErrors,
} from "../../lib/lodgingImportResult";
import { LodgingImportPreviewModal } from "../lodging/LodgingImportPreviewModal";
import { ColumnMappingWizard } from "./ColumnMappingWizard";
import { ImportTileShell, ImportFilePicker, ImportErrorBlock } from "./ImportTileShell";
import type { LodgingImportPreviewRow, LodgingImportSummary } from "../../types/lodgingImport";

interface Props {
  /**
   * Optional: the tile lives in the central import hub (Settings → Import),
   * where there is no list to refresh. It stays a prop so a domain page that
   * embeds the tile next to its own list can still reload after a commit.
   */
  onImported?: () => void | Promise<void>;
}

/**
 * The CSV path — a ONE-TIME MIGRATION TOOL (spec §3.1), not the ongoing
 * lodging import path (that's the email/PDF adapter, `lodgingAdapter.tsx`).
 * Shares the same preview modal and the same batch-commit endpoint as the
 * adapter, so post-commit counts/failures are presented identically.
 */
export function LodgingCsvImportTile({ onImported }: Props): JSX.Element {
  const { t } = useTranslation("lodging");
  const addToast = useToastStore((s) => s.addToast);
  const [records, setRecords] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [suggested, setSuggested] = useState<LodgingCsvMapping>({});
  const [preview, setPreview] = useState<{
    rows: LodgingImportPreviewRow[];
    summary: LodgingImportSummary;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Shown INSIDE the wizard: a rejected mapping leaves it open, so a message
  // rendered only on the page behind it never reaches the user.
  const [mappingError, setMappingError] = useState<string | null>(null);

  const fields = useMemo(
    () => buildLodgingMappingFields((f: LodgingCsvField) => t(`lodging:import.fields.${f}`)),
    [t]
  );

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      setError(null);
      try {
        const rows = parseCsv(await file.text());
        if (rows.length === 0) {
          setError(t("lodging:import.errors.emptyCsv"));
          return;
        }
        setRecords(rows);
        setFileName(file.name);
        setHeaders(Object.keys(rows[0]));
        setSamples(rows[0]);

        // Advisory only: the wizard already has its own header heuristic, so
        // a slow or dead LLM costs nothing but this await (the client
        // resolves to `{}` on any failure — it never rejects).
        setSuggested(await suggestLodgingCsvMapping(Object.keys(rows[0]), rows.slice(0, 3)));
      } catch (err) {
        // Never surface the raw parse error — it may be untranslated/
        // technical. Log it, show the fixed translated string.
        logger.error("LodgingCsvImportTile: CSV parse failed", err);
        setError(t("lodging:import.errors.parseFailed"));
      }
    },
    [t]
  );

  const handleMappingSubmit = useCallback(
    async (mapping: LodgingCsvMapping): Promise<void> => {
      if (!records) return;
      const built = buildLodgingCandidates(records, mapping);
      if (built.candidates.length === 0) {
        // A dead end that only says "nothing could be read" leaves the user
        // guessing which of their columns is wrong — name the reason and an
        // offending value instead, in the wizard they are still looking at.
        const message =
          describeLodgingRowErrors(built.rowErrors, 0, t) ?? t("lodging:import.errors.noRows");
        setMappingError(message);
        setError(message);
        return;
      }
      setMappingError(null);
      try {
        const result = await previewLodgingImport(built.candidates);
        setPreview(result);
        // Never silently dropped (spec §5) — surfaced with a count.
        setError(describeLodgingRowErrors(built.rowErrors, built.candidates.length, t));
      } catch (err) {
        logger.error("LodgingCsvImportTile: preview request failed", err);
        setError(t("lodging:import.errors.previewFailed"));
      }
    },
    [records, t]
  );

  const reset = useCallback((): void => {
    setRecords(null);
    setFileName(null);
    setHeaders([]);
    setSamples({});
    setSuggested({});
    setPreview(null);
    setError(null);
    setMappingError(null);
  }, []);

  return (
    <ImportTileShell
      title={t("lodging:import.csv.title")}
      description={t("lodging:import.csv.description")}
      picker={
        <ImportFilePicker
          label={t("lodging:import.csv.uploadLabel")}
          accept=".csv"
          onFile={(file) => void handleFile(file)}
        />
      }
      errorBlock={error ? <ImportErrorBlock message={error} /> : undefined}
    >
      {records && !preview && (
        <ColumnMappingWizard
          fields={fields}
          csvHeaders={headers}
          csvSamples={samples}
          initialMapping={suggested}
          onSubmit={(mapping) => void handleMappingSubmit(mapping)}
          onCancel={reset}
          submitError={mappingError}
        />
      )}
      {preview && (
        <LodgingImportPreviewModal
          rows={preview.rows}
          summary={preview.summary}
          onCancel={reset}
          onCommit={async (rows) => {
            const result = await commitLodgingImport("csv", fileName, rows);
            const toast = describeLodgingCommitResult(result, t);
            addToast(toast.type, toast.message);
            reset();
            await onImported?.();
          }}
        />
      )}
    </ImportTileShell>
  );
}
