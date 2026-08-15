import { api } from "./client";
import { logger } from "../logger";
import type {
  LodgingImportCandidate,
  LodgingImportCommitResult,
  LodgingImportCommitRow,
  LodgingImportPreviewRow,
  LodgingImportSource,
  LodgingImportSummary,
} from "../../types/lodgingImport";

interface Envelope<T> {
  success: boolean;
  data: T;
}

export const previewLodgingImport = async (
  candidates: LodgingImportCandidate[],
): Promise<{ rows: LodgingImportPreviewRow[]; summary: LodgingImportSummary }> => {
  const { data } = await api.post<
    Envelope<{ rows: LodgingImportPreviewRow[]; summary: LodgingImportSummary }>
  >("/lodging-import/preview", { candidates });
  return data.data;
};

export const commitLodgingImport = async (
  source: LodgingImportSource,
  fileName: string | null,
  rows: LodgingImportCommitRow[],
): Promise<LodgingImportCommitResult> => {
  const { data } = await api.post<Envelope<LodgingImportCommitResult>>("/lodging-import/commit", {
    source,
    fileName,
    rows,
  });
  return data.data;
};

// The batch list and the revert used to live here, lodging-only. They moved to
// `lib/api/importBatches.ts` when flights and cruises started recording their
// imports too — one log, one way back, whatever area the rows landed in. The
// server still answers the old `/lodging-import/batches` paths for anyone
// scripting against them with an API token.

/**
 * The LLM is NEVER in the critical path: any failure (network, timeout,
 * Ollama down) resolves to `{}` and the caller falls back to its header-name
 * heuristic. It must not reject — a component awaiting this without a
 * try/catch would otherwise be one Ollama outage away from an unhandled
 * rejection during CSV import.
 */
export const suggestLodgingCsvMapping = async (
  headers: string[],
  sampleRows: Record<string, string>[],
): Promise<Record<string, string>> => {
  try {
    const { data } = await api.post<Envelope<{ mapping: Record<string, string> }>>(
      "/lodging-import/suggest-mapping",
      { headers, sampleRows },
    );
    return data.data.mapping ?? {};
  } catch (err) {
    logger.warn("lodging mapping suggestion failed — using the header heuristic", err);
    return {};
  }
};
