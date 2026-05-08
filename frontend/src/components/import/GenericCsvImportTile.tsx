import { useState, useCallback } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { parseCsv } from "../../lib/csvParser";
import { parseGenericCsv, type GenericMapping } from "../../lib/importers/genericCsv";
import { postImportPreview, type PreviewResponse } from "../../lib/api/import";
import { ColumnMappingWizard } from "./ColumnMappingWizard";
import { PreviewModal } from "./PreviewModal";
import { commitPreviewRows } from "./commitPreview";

export function GenericCsvImportTile(): JSX.Element {
  const { t } = useTranslation();
  const [csvText, setCsvText] = useState<string | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File): Promise<void> => {
    const text = await file.text();
    const records = parseCsv(text);
    if (records.length === 0) {
      setError("Empty CSV.");
      return;
    }
    setCsvText(text);
    setCsvHeaders(Object.keys(records[0]));
  }, []);

  const handleMappingSubmit = useCallback(
    async (mapping: GenericMapping): Promise<void> => {
      if (!csvText) return;
      const parsed = parseGenericCsv(csvText, mapping);
      if (parsed.parserErrors.length > 0) {
        setError(
          parsed.parserErrors
            .map((e) => `${e.field ?? "spec"} (row ${e.rowIndex}): ${e.message}`)
            .slice(0, 5)
            .join("\n"),
        );
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
    <div className="import-tile">
      <h3>{t("settings:import.tile.genericCsv.title")}</h3>
      <p>{t("settings:import.tile.genericCsv.description")}</p>
      <label>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <span>{t("settings:import.tile.genericCsv.uploadLabel")}</span>
      </label>
      {error && <pre className="import-error">{error}</pre>}
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
          onCommit={(rows) =>
            commitPreviewRows(rows, "imported_generic_csv").then(() => {
              setPreview(null);
              setCsvText(null);
            })
          }
          onCancel={() => {
            setPreview(null);
            setCsvText(null);
          }}
        />
      )}
    </div>
  );
}
