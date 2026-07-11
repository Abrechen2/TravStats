import { api } from "./client";
import { logger } from "../logger";
import type {
  LodgingImportBatchSummary,
  LodgingImportCandidate,
  LodgingImportCommitResult,
  LodgingImportCommitRow,
  LodgingImportPreviewRow,
  LodgingImportRevertResult,
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

export const listLodgingImportBatches = async (): Promise<LodgingImportBatchSummary[]> => {
  const { data } =
    await api.get<Envelope<LodgingImportBatchSummary[]>>("/lodging-import/batches");
  return data.data;
};

export const revertLodgingImportBatch = async (
  batchId: string,
): Promise<LodgingImportRevertResult> => {
  const { data } = await api.delete<Envelope<LodgingImportRevertResult>>(
    `/lodging-import/batches/${batchId}`,
  );
  return data.data;
};

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
