import { useCallback, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";
import { commitPlaceImport, previewPlaceImport } from "../../lib/api/placeImport";
import { parseApi, type ParseEmailPlaceResult } from "../../lib/api/parse";
import { fileToBase64, isPdfFile } from "../../lib/fileBase64";
import { describePlaceCommitResult } from "../../lib/placeImportResult";
import { PlaceImportPreviewModal } from "../places/PlaceImportPreviewModal";
import { ImportTileShell, ImportFilePicker, ImportErrorBlock } from "./ImportTileShell";
import type { PlaceImportPreview } from "../../types/placeImport";

type PlaceReading = Pick<ParseEmailPlaceResult, "candidates" | "fallbackCode">;
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

  // Every way in goes through the same parse routes as any other domain's
  // document (`domain: "place"`), so the server reads a pasted text, a mail
  // file and its subject alike.
  const readWith = useCallback(
    async (parse: () => Promise<PlaceReading>): Promise<void> => {
      setError(null);
      setBusy(true);
      try {
        const reading = await parse();
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
    },
    [t]
  );

  const read = useCallback(
    (): Promise<void> => readWith(() => parseApi.parseEmail(text.trim(), undefined, "place")),
    [readWith, text]
  );

  // A PDF ticket goes through the same PDF route and text extraction as any
  // other domain's PDF; a mail file through the mail-file route.
  const handleFile = useCallback(
    (file: File): Promise<void> =>
      readWith(async () =>
        isPdfFile(file)
          ? parseApi.parsePdf(await fileToBase64(file), "place")
          : parseApi.parseEmailFile(file, "place")
      ),
    [readWith]
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
              accept=".txt,.eml,.msg,.pdf"
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
