import { api } from "./client";

/**
 * `POST /flights/bulk-edit` (forgejo#217) — mirrors
 * `backend/src/schemas/flightBulkEdit.ts`. Bare answers (ADR 0001).
 */

export type ListEditMode = "add" | "replace";

/** The server's cap (`BULK_EDIT_MAX_FLIGHTS` in backend/src/schemas/flightBulkEdit.ts). */
export const BULK_EDIT_MAX_FLIGHTS = 200;

/**
 * Its own timeout: 200 flights are 200 small transactions, which outlast the
 * shared client's 10 s on a slow database while the server finishes — and a
 * timed-out edit is one whose outcome nobody knows (review I2).
 */
const BULK_EDIT_TIMEOUT_MS = 60_000;

export interface FlightBulkEditInput {
  flightIds: string[];
  trip?: { mode: "set"; tripId: string } | { mode: "clear" };
  tags?: { mode: ListEditMode; values: string[] };
  companions?: { mode: ListEditMode; values: string[] };
}

export interface FlightBulkEditResult {
  flightId: string;
  status: "updated" | "unchanged" | "failed";
  /** Present only for `failed`. */
  code?: "FLIGHT_NOT_FOUND" | "UPDATE_FAILED";
}

export interface FlightBulkEditAnswer {
  results: FlightBulkEditResult[];
  summary: { updated: number; unchanged: number; failed: number };
}

export const flightBulkEditApi = {
  edit: async (input: FlightBulkEditInput): Promise<FlightBulkEditAnswer> => {
    const { data } = await api.post<FlightBulkEditAnswer>("/flights/bulk-edit", input, {
      timeout: BULK_EDIT_TIMEOUT_MS,
    });
    return data;
  },
};
