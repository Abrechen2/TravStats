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

/** One row an import brought in. */
export interface ImportBatchItem {
  kind: "flight" | "cruise" | "lodging" | "stay";
  id: string;
  label: string;
  date: string | null;
  detail: string | null;
}

export interface ImportBatchItems {
  items: ImportBatchItem[];
  total: number;
  /** True when the list is a prefix of `total` — one import must not turn a
   *  panel into a thousand-row page. */
  truncated: boolean;
}

/**
 * The rows themselves. The log has always known HOW MANY an import brought in;
 * this says WHICH — so "undo this import" stops being a decision made blind.
 *
 * Called only when a section is expanded, never up front: opening the log with
 * ten runs in it would otherwise fire ten requests for lists nobody looked at.
 */
export async function listImportBatchItems(batchId: string): Promise<ImportBatchItems> {
  const res = await api.get<Envelope<ImportBatchItems>>(`/import-batches/${batchId}/items`);
  return res.data.data;
}

export async function revertImportBatch(batchId: string): Promise<ImportRevertSummary> {
  const res = await api.delete<Envelope<ImportRevertSummary>>(`/import-batches/${batchId}`);
  return res.data.data;
}
