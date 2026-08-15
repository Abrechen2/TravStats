import { useState, useCallback } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { parseFr24 } from "../../lib/importers/fr24";
import { postImportPreview, type PreviewResponse } from "../../lib/api/import";
import { PreviewModal } from "./PreviewModal";
import { commitPreviewRows } from "./commitPreview";
import { ImportTileShell, ImportFilePicker, ImportErrorBlock } from "./ImportTileShell";

export function Fr24ImportTile(): JSX.Element {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = useCallback(async (file: File): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseFr24(text);
      if (parsed.parserErrors.length > 0) {
        const total = parsed.parserErrors.length;
        const lines = parsed.parserErrors.slice(0, 5).map((e) => `Row ${e.rowIndex}: ${e.message}`);
        if (total > 5) lines.push(`… and ${total - 5} more`);
        setError(lines.join("\n"));
        return;
      }
      const result = await postImportPreview(parsed.rows);
      setPreview(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <ImportTileShell
      title={t("settings:import.tile.fr24.title")}
      description={t("settings:import.tile.fr24.description")}
      picker={
        <ImportFilePicker
          label={t("settings:import.tile.fr24.uploadLabel")}
          accept=".csv"
          disabled={busy}
          onFile={(file) => void handleFile(file)}
        />
      }
      errorBlock={error ? <ImportErrorBlock message={error} /> : undefined}
    >
      {preview && (
        <PreviewModal
          rows={preview.rows}
          summary={preview.summary}
          flightsListHref="/flights"
          onCommit={async (rows) => {
            const result = await commitPreviewRows(rows, "imported_fr24");
            if (result.failures.length > 0) {
              setError(
                `Imported ${result.committed} of ${rows.length}. ${result.failures.length} chunk(s) failed: ${result.failures.map((f) => `chunk ${f.chunkIndex}: ${f.error}`).join("; ")}`
              );
            }
            return {
              committed: result.committed,
              alreadyPresent: result.skipped,
              failedChunks: result.failures.length,
            };
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </ImportTileShell>
  );
}
