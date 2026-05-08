import { useState, useCallback } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { parseFr24 } from "../../lib/importers/fr24";
import { postImportPreview, type PreviewResponse } from "../../lib/api/import";
import { PreviewModal } from "./PreviewModal";
import { commitPreviewRows } from "./commitPreview";

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
    <div className="import-tile">
      <h3>{t("settings:import.tile.fr24.title")}</h3>
      <p>{t("settings:import.tile.fr24.description")}</p>
      <label>
        <input
          type="file"
          accept=".csv"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <span>{t("settings:import.tile.fr24.uploadLabel")}</span>
      </label>
      {error && <pre className="import-error">{error}</pre>}
      {preview && (
        <PreviewModal
          rows={preview.rows}
          summary={preview.summary}
          onCommit={async (rows) => {
            const result = await commitPreviewRows(rows, "imported_fr24");
            if (result.failures.length > 0) {
              setError(
                `Imported ${result.committed} of ${rows.length}. ${result.failures.length} chunk(s) failed: ${result.failures.map((f) => `chunk ${f.chunkIndex}: ${f.error}`).join("; ")}`,
              );
            }
            setPreview(null);
          }}
          onCancel={() => setPreview(null)}
        />
      )}
    </div>
  );
}
