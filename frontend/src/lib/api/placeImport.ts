import { api } from "./client";
import { waitForJob } from "./jobs";
import type {
  PlaceDocumentReading,
  PlaceImportCandidate,
  PlaceImportCommitResult,
  PlaceImportPreview,
  PlaceImportResolution,
  PlaceImportSource,
} from "../../types/placeImport";

interface Envelope<T> {
  success: boolean;
  data: T;
}

/**
 * The two calls behind POI Phase D §5, mirroring `lodgingImport.ts`.
 *
 * Two steps, never one: preview says what WOULD happen, commit does it. The
 * backend (`routes/placeImport.ts`) is mounted at `/place-import`, deliberately
 * not under `/places/import` — `GET /places/:id` would swallow "import" as an
 * id. Both routes are behind the write scope and the lodging import's limiter.
 */
export const previewPlaceImport = async (
  candidates: PlaceImportCandidate[]
): Promise<PlaceImportPreview> => {
  const { data } = await api.post<Envelope<PlaceImportPreview>>("/place-import/preview", {
    candidates,
  });
  return data.data;
};

/**
 * Reads one place document — a museum ticket, a tour booking — with the
 * user's place templates (forgejo#124). Writes nothing: a candidate goes
 * through `previewPlaceImport` like a CSV row, and an empty answer carries the
 * reason as a code.
 */
export const readPlaceDocument = async (
  text: string,
  subject?: string
): Promise<PlaceDocumentReading> => {
  const { data } = await api.post<Envelope<PlaceDocumentReading>>("/place-import/document", {
    text,
    ...(subject ? { subject } : {}),
  });
  return data.data;
};

/**
 * Writes the rows the user decided to create, as ONE revertible batch.
 *
 * Only candidates travel — the commit schema has no `action` field, so a row
 * the user skipped is simply not sent. A row without a position is reported
 * back as `no_position`, never written: `Place` is a point, and the preview is
 * where that row was offered for one.
 */
/**
 * Resolve a Google Takeout list for the preview (#358): positions from the
 * CID in each link, the trip a country-named list belongs to, the visit day
 * from photographs. A background job on the server — a few hundred lookups
 * outlast the request timeout — so this starts it and waits for the outcome.
 * A failed job throws `JobFailedError`, a lost one `JobLostError`.
 */
export const resolvePlaceImport = async (
  listName: string | null,
  rows: Array<
    Pick<PlaceImportCandidate, "sourceRowIndex" | "name" | "externalRef" | "lat" | "lon">
  >,
  onProgress?: (progress: { done: number; total: number } | null) => void
): Promise<PlaceImportResolution> => {
  const { data } = await api.post<Envelope<{ jobId: string }>>("/place-import/resolve", {
    listName,
    rows,
  });
  return waitForJob<PlaceImportResolution>(data.data.jobId, {
    onPoll: (job) => onProgress?.(job.progress),
  });
};

export const commitPlaceImport = async (
  source: PlaceImportSource,
  fileName: string | null,
  rows: PlaceImportCandidate[]
): Promise<PlaceImportCommitResult> => {
  const { data } = await api.post<Envelope<PlaceImportCommitResult>>("/place-import/commit", {
    source,
    fileName,
    rows,
  });
  return data.data;
};
