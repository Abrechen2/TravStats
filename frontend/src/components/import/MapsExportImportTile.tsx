import { useCallback, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";
import { parseCsv } from "../../lib/csvParser";
import { readMapsExport, mapsExternalRef } from "../../lib/mapsExport";
import { commitLodgingImport, previewLodgingImport } from "../../lib/api/lodgingImport";
import { describeLodgingCommitResult } from "../../lib/lodgingImportResult";
import { LodgingImportPreviewModal } from "../lodging/LodgingImportPreviewModal";
import type {
  LodgingImportCandidate,
  LodgingImportPreviewRow,
  LodgingImportSummary,
} from "../../types/lodgingImport";
import { ImportTileShell, ImportFilePicker, ImportErrorBlock } from "./ImportTileShell";

interface Props {
  onImported?: () => void | Promise<void>;
}

/**
 * A Google-Maps saved list, imported as itself.
 *
 * It gets its own tile rather than going through the generic CSV path because
 * it carries something no other spreadsheet does: the URL of each row holds
 * Google's id for exactly the place that was saved. Fed through the column
 * wizard it would be reduced to a name — and a name is not an identity. That
 * is not theory: matching this very list by name once put a hotel from
 * Marktoberdorf in Rome.
 *
 * So the id is carried through as the row's provenance. Importing the same
 * list twice recognises what it already holds instead of doubling it, and a
 * later enrichment can ask Google about THAT place rather than about a name.
 *
 * Nothing else from the export is trusted: a saved list says what a place is
 * called, not when anyone slept there. Dates, prices and ratings are left
 * empty on purpose.
 */
export function MapsExportImportTile({ onImported }: Props): JSX.Element {
  const { t } = useTranslation(["lodging", "settings", "common"]);
  const addToast = useToastStore((s) => s.addToast);

  const [candidates, setCandidates] = useState<LodgingImportCandidate[] | null>(null);
  const [preview, setPreview] = useState<{
    rows: LodgingImportPreviewRow[];
    summary: LodgingImportSummary;
  } | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback((): void => {
    setCandidates(null);
    setPreview(null);
    setFileName(null);
    setError(null);
  }, []);

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      setError(null);
      setFileName(file.name);
      try {
        const records = parseCsv(await file.text());
        const { rows, withoutCid } = readMapsExport(records);
        if (rows.length === 0) {
          setError(t("lodging:import.maps.noRows"));
          return;
        }

        const built: LodgingImportCandidate[] = rows.map((row, index) => ({
          sourceRowIndex: index,
          lodging: {
            name: row.name,
            // Only where there IS one. A made-up key would be worse than none:
            // it would make two unidentifiable rows look like the same place.
            externalRef: row.cid ? mapsExternalRef(row.cid) : null,
            notes: row.note,
          },
          stay: null,
        }));
        setCandidates(built);

        // Said out loud rather than swallowed: a row without an id can still
        // be imported, but it cannot be recognised on a second run.
        if (withoutCid > 0) {
          setError(t("lodging:import.maps.withoutId", { count: withoutCid }));
        }

        const result = await previewLodgingImport(built);
        setPreview(result);
      } catch (err: unknown) {
        logger.error("MapsExportImportTile: reading the export failed", err);
        setError(t("lodging:import.errors.previewFailed"));
      }
    },
    [t]
  );

  return (
    <ImportTileShell
      title={t("lodging:import.maps.title")}
      description={t("lodging:import.maps.description")}
      picker={
        <ImportFilePicker
          label={t("lodging:import.maps.uploadLabel")}
          accept=".csv"
          onFile={(file) => void handleFile(file)}
        />
      }
      errorBlock={error ? <ImportErrorBlock message={error} /> : undefined}
    >
      {preview && candidates && (
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
