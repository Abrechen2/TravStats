import { api } from "./client";
import type { BulkDomain } from "../../shared/bulkEditFields";

/**
 * `POST /<domain>/bulk-edit` (forgejo#405 A4) — mirrors
 * `backend/src/schemas/domainBulkEdit.ts`. Enveloped answers (ADR 0001): the
 * rail, bus, ferry, rental, cruise and lodging routers speak `{success, data}`.
 */

export type ListEditMode = "add" | "replace";
export type TextEdit = { mode: "set"; value: string } | { mode: "clear" };

export interface DomainBulkEditInput {
  ids: string[];
  /** id → the `updatedAt` the row was read at; a row that moved on is not written. */
  baseVersions?: Record<string, string>;
  trip?: { mode: "set"; tripId: string } | { mode: "clear" };
  tags?: { mode: ListEditMode; values: string[] };
  companions?: { mode: ListEditMode; values: string[] };
  status?: { mode: "cancel" | "reinstate" };
  operator?: TextEdit;
  serviceClass?: TextEdit;
}

export type BulkResultCode = "NOT_FOUND" | "UPDATE_FAILED" | "VERSION_CONFLICT";

export interface DomainBulkEditResult {
  id: string;
  status: "updated" | "unchanged" | "failed";
  /** Present only for `failed`. */
  code?: BulkResultCode;
}

export interface DomainBulkEditAnswer {
  results: DomainBulkEditResult[];
  summary: { updated: number; unchanged: number; failed: number };
}

const PATHS: Record<BulkDomain, string> = {
  rail: "/rail/bulk-edit",
  bus: "/bus/bulk-edit",
  ferry: "/ferry/bulk-edit",
  rental: "/rentals/bulk-edit",
  cruise: "/cruises/bulk-edit",
  stay: "/lodging/stays/bulk-edit",
};

/** 200 rows are 200 small transactions, which outlast the shared client's 10 s on a slow database. */
const BULK_EDIT_TIMEOUT_MS = 60_000;

export const domainBulkEditApi = {
  edit: async (domain: BulkDomain, input: DomainBulkEditInput): Promise<DomainBulkEditAnswer> => {
    const { data } = await api.post<{ success: true; data: DomainBulkEditAnswer }>(
      PATHS[domain],
      input,
      { timeout: BULK_EDIT_TIMEOUT_MS }
    );
    return data.data;
  },
};
