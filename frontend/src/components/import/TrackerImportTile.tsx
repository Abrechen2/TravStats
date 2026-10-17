import { useState, useCallback } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { parseTrackerExport, postImportPreview, type PreviewResponse } from "../../lib/api/import";
import type { DetectableFormat } from "../../lib/importers/types";
import { PreviewModal } from "./PreviewModal";
import { commitPreviewRows } from "./commitPreview";
import { ImportTileShell, ImportFilePicker, ImportErrorBlock } from "./ImportTileShell";
import { describeParseResult } from "./parserErrorCopy";
import { logger } from "../../lib/logger";

/** The server's ceiling for a tracker export (`MAX_TRACKER_BYTES` in routes/import.ts). */
const MAX_CONTENT_CHARS = 5_000_000;
const BYTES_PER_MB = 1_000_000;

/**
 * AirTrail exports carry each flight's recorded track, which the import does
 * not read and which can run to megabytes per flight. Dropping it before the
 * upload keeps a large logbook under the server's ceiling. Anything that is
 * not an AirTrail-shaped JSON goes up untouched — the server decides what it
 * is and says so.
 */
function withoutAirTrailTracks(content: string): string {
  if (!content.trimStart().startsWith("{")) return content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Broken JSON goes up as it is; the server answers "invalid JSON".
    return content;
  }
  if (typeof parsed !== "object" || parsed === null) return content;
  const flights = (parsed as { flights?: unknown }).flights;
  if (!Array.isArray(flights)) return content;
  const slim = flights.map((flight: unknown) => {
    if (typeof flight !== "object" || flight === null) return flight;
    const {
      track: _track,
      customFields: _customFields,
      ...rest
    } = flight as Record<string, unknown>;
    return rest;
  });
  return JSON.stringify({ ...(parsed as object), flights: slim });
}

/**
 * One drop zone for another flight tracker's export (forgejo#311). The server
 * recognises the format and reads the file; the rows then take the same path
 * as an FR24 import — preview, duplicate check, one undoable batch — and are
 * stored with the app's own data source.
 */
export function TrackerImportTile(): JSX.Element {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [format, setFormat] = useState<DetectableFormat | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      setError(null);
      setBusy(true);
      try {
        const content = withoutAirTrailTracks(await file.text());
        if (content.length > MAX_CONTENT_CHARS) {
          setError(
            t("settings:import.parserErrors.tooLarge", {
              size: (content.length / BYTES_PER_MB).toFixed(1),
              max: MAX_CONTENT_CHARS / BYTES_PER_MB,
            })
          );
          return;
        }
        const parsed = await parseTrackerExport(content);
        const outcome = describeParseResult(parsed, t, { expected: parsed.expected });
        if (outcome.fatal || !parsed.format) {
          setError(outcome.fatal ?? t("settings:import.parserErrors.unknownFormat"));
          return;
        }
        const result = await postImportPreview(parsed.rows);
        const detected = t("settings:import.tile.tracker.detected", {
          format: t(`settings:import.tile.tracker.formats.${parsed.format}`),
        });
        setFormat(parsed.format);
        setFileName(file.name);
        setNotice([detected, outcome.skippedNotice].filter(Boolean).join("\n"));
        setPreview(result);
      } catch (err: unknown) {
        // The sentence is the user's; the cause belongs in the log.
        logger.error("TrackerImportTile: parse or preview failed", err);
        setError(t("settings:import.parserErrors.previewFailed"));
      } finally {
        setBusy(false);
      }
    },
    [t]
  );

  return (
    <ImportTileShell
      title={t("settings:import.tile.tracker.title")}
      description={t("settings:import.tile.tracker.description")}
      picker={
        <ImportFilePicker
          label={t("settings:import.tile.tracker.uploadLabel")}
          accept=".csv,.json,.txt"
          disabled={busy}
          onFile={(file) => void handleFile(file)}
        />
      }
      errorBlock={error ? <ImportErrorBlock message={error} /> : undefined}
    >
      {preview && format && (
        <PreviewModal
          rows={preview.rows}
          summary={preview.summary}
          flightsListHref="/flights"
          notice={notice}
          onCommit={async (rows) => {
            const result = await commitPreviewRows(rows, `imported_${format}`, fileName);
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
