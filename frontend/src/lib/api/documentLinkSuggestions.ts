import { api } from "./client";

/**
 * "Dieses Dokument belegt auch …" (`/api/v1/document-link-suggestions`, plan D4
 * of docs/superpowers/specs/2026-11-21-document-links.md). Enveloped.
 *
 * Reading the list starts the one-time scan of stored documents on the server
 * as a job; `pass.jobId` names it, `getJob` reads its progress.
 */

interface Envelope<T> {
  success: boolean;
  data: T;
}

export type LinkSuggestionReason =
  "bookingReference" | "flightNumber" | "trainNumber" | "lineName" | "hotelDates" | "dateRange";

export interface SuggestedEntry {
  suggestionId: string;
  entry: { type: string; id: string };
  label: string;
  reason: LinkSuggestionReason;
}

export interface DocumentLinkSuggestion {
  documentId: string;
  displayName: string;
  kind: string | null;
  entries: SuggestedEntry[];
}

export interface DocumentLinkSuggestionList {
  suggestions: DocumentLinkSuggestion[];
  total: number;
  pass: { jobId: string | null };
}

export const documentLinkSuggestionsApi = {
  list: async (): Promise<DocumentLinkSuggestionList> => {
    const { data } = await api.get<Envelope<DocumentLinkSuggestionList>>(
      "/document-link-suggestions"
    );
    return data.data;
  },

  /** `suggestionIds` absent = every pending entry of the document. */
  accept: async (
    documentId: string,
    suggestionIds?: string[]
  ): Promise<{ linked: number; skipped: number }> => {
    const { data } = await api.post<Envelope<{ linked: number; skipped: number }>>(
      `/document-link-suggestions/${documentId}/accept`,
      suggestionIds ? { suggestionIds } : {}
    );
    return data.data;
  },

  dismiss: async (documentId: string, suggestionIds?: string[]): Promise<void> => {
    await api.post(
      `/document-link-suggestions/${documentId}/dismiss`,
      suggestionIds ? { suggestionIds } : {}
    );
  },
};
