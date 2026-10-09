import { api } from "./client";

/**
 * `POST /flights/bulk-edit` (forgejo#217) — mirrors
 * `backend/src/schemas/flightBulkEdit.ts`. Bare answers (ADR 0001).
 */

export type ListEditMode = "add" | "replace";

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
    const { data } = await api.post<FlightBulkEditAnswer>("/flights/bulk-edit", input);
    return data;
  },
};
