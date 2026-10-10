import { useState, useCallback } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { parseFr24 } from "../../lib/importers/fr24";
import { postImportPreview, type PreviewResponse } from "../../lib/api/import";
import { PreviewModal } from "./PreviewModal";
import { commitPreviewRows } from "./commitPreview";
import { ImportTileShell, ImportFilePicker, ImportErrorBlock } from "./ImportTileShell";
import { describeParseResult } from "./parserErrorCopy";

export function Fr24ImportTile(): JSX.Element {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [skippedNotice, setSkippedNotice] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      setError(null);
      setBusy(true);
      try {
        const text = await file.text();
        const parsed = parseFr24(text);
        const outcome = describeParseResult(parsed, t);
        if (outcome.fatal) {
          setError(outcome.fatal);
          return;
        }
        const result = await postImportPreview(parsed.rows);
        setSkippedNotice(outcome.skippedNotice);
        setPreview(result);
      } catch {
        setError(t("settings:import.parserErrors.previewFailed"));
      } finally {
        setBusy(false);
      }
    },
    [t]
  );

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
          notice={skippedNotice}
          onCommit={async (rows) => {
            const result = await commitPreviewRows(rows, "imported_fr24");
            if (result.failures.length > 0) {
              setError(
                t("settings:import.parserErrors.commitPartial", {
                  committed: result.committed,
                  total: rows.length,
                })
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
