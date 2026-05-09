import { useState, useCallback } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { parseCsv } from "../../lib/csvParser";
import { parseGenericCsv, type GenericMapping } from "../../lib/importers/genericCsv";
import { postImportPreview, type PreviewResponse } from "../../lib/api/import";
import { ColumnMappingWizard } from "./ColumnMappingWizard";
import { PreviewModal } from "./PreviewModal";
import { commitPreviewRows } from "./commitPreview";
import { ImportTileShell, ImportFilePicker, ImportErrorBlock } from "./ImportTileShell";

export function GenericCsvImportTile(): JSX.Element {
  const { t } = useTranslation();
  const [csvText, setCsvText] = useState<string | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File): Promise<void> => {
    try {
      const text = await file.text();
      const records = parseCsv(text);
      if (records.length === 0) {
        setError("Empty CSV.");
        return;
      }
      setCsvText(text);
      setCsvHeaders(Object.keys(records[0]));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleMappingSubmit = useCallback(
    async (mapping: GenericMapping): Promise<void> => {
      if (!csvText) return;
      const parsed = parseGenericCsv(csvText, mapping);
      if (parsed.parserErrors.length > 0) {
        const total = parsed.parserErrors.length;
        const lines = parsed.parserErrors
          .slice(0, 5)
          .map((e) => `${e.field ?? "spec"} (row ${e.rowIndex}): ${e.message}`);
        if (total > 5) lines.push(`… and ${total - 5} more`);
        setError(lines.join("\n"));
        return;
      }
      try {
        const result = await postImportPreview(parsed.rows);
        setPreview(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [csvText],
  );

  return (
    <ImportTileShell
      title={t("settings:import.tile.genericCsv.title")}
      description={t("settings:import.tile.genericCsv.description")}
      picker={
        <ImportFilePicker
          label={t("settings:import.tile.genericCsv.uploadLabel")}
          accept=".csv"
          onFile={(file) => void handleFile(file)}
        />
      }
      errorBlock={error ? <ImportErrorBlock message={error} /> : undefined}
    >
      {csvText && !preview && (
        <ColumnMappingWizard
          csvHeaders={csvHeaders}
          onSubmit={(mapping) => void handleMappingSubmit(mapping)}
          onCancel={() => {
            setCsvText(null);
            setCsvHeaders([]);
          }}
        />
      )}
      {preview && (
        <PreviewModal
          rows={preview.rows}
          summary={preview.summary}
          flightsListHref="/flights"
          onCommit={async (rows) => {
            const result = await commitPreviewRows(rows, "imported_generic_csv");
            if (result.failures.length > 0) {
              setError(
                `Imported ${result.committed} of ${rows.length}. ${result.failures.length} chunk(s) failed: ${result.failures.map((f) => `chunk ${f.chunkIndex}: ${f.error}`).join("; ")}`,
              );
            }
            return {
              committed: result.committed,
              failedChunks: result.failures.length,
            };
          }}
          onClose={() => {
            setPreview(null);
            setCsvText(null);
          }}
        />
      )}
    </ImportTileShell>
  );
}
