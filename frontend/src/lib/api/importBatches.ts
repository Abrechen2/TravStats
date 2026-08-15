import { api } from "./client";

/**
 * Import batches, across every domain.
 *
 * Stays had this endpoint to themselves; flights and cruises left no trace, so
 * the log could only ever show a third of what the user had imported. One
 * record now, one list, one way to take a run back.
 */

export type ImportBatchDomain = "flight" | "cruise" | "lodging";
export type ImportBatchSource = "csv" | "email" | "pdf";

export interface ImportBatchSummary {
  id: string;
  domain: ImportBatchDomain;
  source: ImportBatchSource;
  fileName: string | null;
  createdAt: string;
  /** Rows this batch still owns, per kind — a reverted-around row is gone from here. */
  counts: { lodgings: number; stays: number; flights: number; cruises: number };
}

export interface ImportRevertSummary {
  domain: ImportBatchDomain;
  deleted: number;
  /** Lodging only: kept because other stays still hang from them. */
  detached?: number;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

export async function listImportBatches(): Promise<ImportBatchSummary[]> {
  const res = await api.get<Envelope<ImportBatchSummary[]>>("/import-batches");
  return res.data.data;
}

export async function createImportBatch(
  domain: ImportBatchDomain,
  source: ImportBatchSource,
  fileName: string | null,
): Promise<string> {
  const res = await api.post<Envelope<{ id: string }>>("/import-batches", {
    domain,
    source,
    fileName,
  });
  return res.data.data.id;
}

export async function revertImportBatch(batchId: string): Promise<ImportRevertSummary> {
  const res = await api.delete<Envelope<ImportRevertSummary>>(`/import-batches/${batchId}`);
  return res.data.data;
}
