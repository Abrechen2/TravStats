import { api } from "./client";
import type {
  PlaceImportCandidate,
  PlaceImportCommitResult,
  PlaceImportPreview,
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
 * Writes the rows the user decided to create, as ONE revertible batch.
 *
 * Only candidates travel — the commit schema has no `action` field, so a row
 * the user skipped is simply not sent. A row without a position is reported
 * back as `no_position`, never written: `Place` is a point, and the preview is
 * where that row was offered for one.
 */
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
