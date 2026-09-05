import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";
import { parseCsv } from "../../lib/csvParser";
import {
  buildPlaceCandidates,
  buildPlaceMappingFields,
  type PlaceCsvField,
  type PlaceCsvMapping,
} from "../../lib/importers/placeCsv";
import { commitPlaceImport, previewPlaceImport } from "../../lib/api/placeImport";
import { describePlaceCommitResult, describePlaceRowErrors } from "../../lib/placeImportResult";
import { PlaceImportPreviewModal } from "../places/PlaceImportPreviewModal";
import { ColumnMappingWizard } from "./ColumnMappingWizard";
import { ImportTileShell, ImportFilePicker, ImportErrorBlock } from "./ImportTileShell";
import type { PlaceImportPreview } from "../../types/placeImport";

interface Props {
  /**
   * The tile lives in the central import hub (Settings → Import), where the
   * log below it must learn that something landed. Optional so a domain page
   * embedding the tile next to its own list can reload that instead.
   */
  onImported?: () => void | Promise<void>;
}

/**
 * Places from a spreadsheet — POI Phase D §5, the surface the `poiDomain`
 * gate was waiting for.
 *
 * Mirrors `LodgingCsvImportTile`: file → column wizard → preview → commit,
 * with the same tile shell and the same two-step endpoint pair. What differs
 * is the reason the path exists: if the file carries `lat`/`lon`, NO geocoding
 * happens, and that is also the escape hatch for a Google Takeout export the
 * geocoder cannot resolve — export, fill in the coordinates, import again. A
 * row that still has none is not dropped here; the preview offers it back to
 * the user with a position picker.
 */
export function PlaceCsvImportTile({ onImported }: Props): JSX.Element {
  const { t } = useTranslation("places");
  const addToast = useToastStore((s) => s.addToast);
  const [records, setRecords] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [samples, setSamples] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PlaceImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Shown INSIDE the wizard: a rejected mapping leaves it open, so a message
  // rendered only on the page behind it never reaches the user.
  const [mappingError, setMappingError] = useState<string | null>(null);

  const fields = useMemo(
    () => buildPlaceMappingFields((f: PlaceCsvField) => t(`places:import.fields.${f}`)),
    [t]
  );

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      setError(null);
      try {
        const rows = parseCsv(await file.text());
        if (rows.length === 0) {
          setError(t("places:import.errors.emptyCsv"));
          return;
        }
        setRecords(rows);
        setFileName(file.name);
        setHeaders(Object.keys(rows[0]));
        setSamples(rows[0]);
      } catch (err) {
        // Never the raw parse error — it may be technical or untranslated.
        logger.error("PlaceCsvImportTile: CSV parse failed", err);
        setError(t("places:import.errors.parseFailed"));
      }
    },
    [t]
  );

  const handleMappingSubmit = useCallback(
    async (mapping: PlaceCsvMapping): Promise<void> => {
      if (!records) return;
      const built = buildPlaceCandidates(records, mapping);
      if (built.candidates.length === 0) {
        const message =
          describePlaceRowErrors(built.errors, 0, t) ?? t("places:import.errors.noRows");
        setMappingError(message);
        setError(message);
        return;
      }
      setMappingError(null);
      try {
        setPreview(await previewPlaceImport(built.candidates));
        // Dropped rows are never silent — surfaced with a count.
        setError(describePlaceRowErrors(built.errors, built.candidates.length, t));
      } catch (err) {
        logger.error("PlaceCsvImportTile: preview request failed", err);
        setError(t("places:import.errors.previewFailed"));
      }
    },
    [records, t]
  );

  const reset = useCallback((): void => {
    setRecords(null);
    setFileName(null);
    setHeaders([]);
    setSamples({});
    setPreview(null);
    setError(null);
    setMappingError(null);
  }, []);

  return (
    <ImportTileShell
      title={t("places:import.csv.title")}
      description={t("places:import.csv.description")}
      picker={
        <ImportFilePicker
          label={t("places:import.csv.uploadLabel")}
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
          onSubmit={(mapping) => void handleMappingSubmit(mapping)}
          onCancel={reset}
          submitError={mappingError}
        />
      )}
      {preview && (
        <PlaceImportPreviewModal
          rows={preview.rows}
          summary={preview.summary}
          onCancel={reset}
          onCommit={async (rows) => {
            const result = await commitPlaceImport("csv", fileName, rows);
            const toast = describePlaceCommitResult(result, t);
            addToast(toast.type, toast.message);
            reset();
            await onImported?.();
          }}
        />
      )}
    </ImportTileShell>
  );
}
