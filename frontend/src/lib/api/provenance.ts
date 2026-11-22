import { api } from "./client";

/**
 * "Aus der Erinnerung" (`/api/v1/provenance`, docs/superpowers/specs/2026-11-22-remembered-facts.md).
 * Enveloped. An entry is `recorded`, `remembered` (typed in from memory, dates approximate) or
 * unknown (null — everything older than the field).
 */

interface Envelope<T> {
  success: boolean;
  data: T;
}

export type Provenance = "recorded" | "remembered";

export type ProvenanceEntryType =
  | "trip"
  | "flight"
  | "lodgingStay"
  | "railJourney"
  | "busJourney"
  | "ferryJourney"
  | "rentalBooking"
  | "cruise"
  | "placeVisit";

/** The three columns every entry row carries. */
export interface ProvenanceState {
  provenance: Provenance | null;
  /** `YYYY-MM-DD`, the day it was written down. */
  rememberedOn: string | null;
  rememberedNote: string | null;
}

export type NoticeKind = "outsideRememberedSpan" | "outsideRecordedSpan";

export interface NoticeReading {
  type: string;
  id: string;
  label: string;
  from: string | null;
  to: string | null;
}

export interface ProvenanceNotice {
  id: string;
  entryType: string;
  entryId: string;
  kind: NoticeKind;
  detail: { remembered: NoticeReading; recorded: NoticeReading };
  createdAt: string;
}

export const provenanceApi = {
  set: async (
    type: ProvenanceEntryType,
    id: string,
    state: ProvenanceState
  ): Promise<ProvenanceState> => {
    const { data } = await api.put<Envelope<ProvenanceState>>(`/provenance/${type}/${id}`, state);
    return data.data;
  },

  notices: async (): Promise<ProvenanceNotice[]> => {
    const { data } =
      await api.get<Envelope<{ notices: ProvenanceNotice[] }>>("/provenance/notices");
    return data.data.notices;
  },

  dismiss: async (id: string): Promise<void> => {
    await api.post(`/provenance/notices/${id}/dismiss`);
  },
};
