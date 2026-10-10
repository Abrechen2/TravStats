import { useCallback, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";
import {
  commitPlaceImport,
  previewPlaceImport,
  readPlaceDocument,
} from "../../lib/api/placeImport";
import { describePlaceCommitResult } from "../../lib/placeImportResult";
import { PlaceImportPreviewModal } from "../places/PlaceImportPreviewModal";
import { ImportTileShell, ImportFilePicker, ImportErrorBlock } from "./ImportTileShell";
import type { PlaceImportPreview } from "../../types/placeImport";

interface Props {
  /** The import hub's log reload — see `PlaceCsvImportTile`. */
  onImported?: () => void | Promise<void>;
}

/**
 * A place from a document — a museum ticket, a tour booking (forgejo#124).
 *
 * There is no built-in place reader: the document is read by the place
 * templates the user derived in the parser workshop. Whatever they read goes
 * into the SAME preview the CSV import uses — position picker, duplicate
 * check, an explicit "import" — so a place read from a document is never
 * written without the user's confirmation. A document nothing could read says
 * WHY: no template yet, not recognised, or out of time.
 */
export function PlaceDocumentImportTile({ onImported }: Props): JSX.Element {
  const { t } = useTranslation("places");
  const addToast = useToastStore((s) => s.addToast);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PlaceImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const reading = await readPlaceDocument(text.trim());
      if (reading.candidates.length === 0) {
        setError(t(`places:import.document.fallback.${reading.fallbackCode ?? "notRecognised"}`));
        return;
      }
      setPreview(await previewPlaceImport(reading.candidates));
    } catch (err) {
      // Never the raw error — it may be technical or untranslated.
      logger.error("PlaceDocumentImportTile: reading the document failed", err);
      setError(t("places:import.document.readFailed"));
    } finally {
      setBusy(false);
    }
  }, [text, t]);

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      setError(null);
      try {
        setText(await file.text());
      } catch (err) {
        logger.error("PlaceDocumentImportTile: file could not be read", err);
        setError(t("places:import.document.readFailed"));
      }
    },
    [t]
  );

  const reset = useCallback((): void => {
    setText("");
    setPreview(null);
    setError(null);
  }, []);

  return (
    <ImportTileShell
      title={t("places:import.document.title")}
      description={t("places:import.document.description")}
      picker={
        <div className="space-y-2">
          <textarea
            className="input w-full font-mono text-xs"
            rows={5}
            value={text}
            aria-label={t("places:import.document.textLabel")}
            placeholder={t("places:import.document.placeholder")}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || text.trim().length === 0}
              onClick={() => void read()}
            >
              {busy ? t("places:import.document.reading") : t("places:import.document.read")}
            </button>
            <ImportFilePicker
              label={t("places:import.document.uploadLabel")}
              accept=".txt,.eml"
              disabled={busy}
              onFile={(file) => void handleFile(file)}
            />
          </div>
        </div>
      }
      errorBlock={error ? <ImportErrorBlock message={error} /> : undefined}
    >
      {preview && (
        <PlaceImportPreviewModal
          rows={preview.rows}
          summary={preview.summary}
          onCancel={reset}
          onCommit={async (rows) => {
            const result = await commitPlaceImport("document", null, rows);
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
