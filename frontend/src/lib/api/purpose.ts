import { api } from "./client";
import type { Purpose, PurposeDomain, PurposeVisibility } from "../../shared/purpose";

/**
 * Private or business (`/api/v1/purpose`, docs/superpowers/specs/2026-11-22-private-business-purpose.md).
 * Enveloped. `purpose` is `private`, `business` or null (unknown — never read as private).
 */

interface Envelope<T> {
  success: boolean;
  data: T;
}

export type PurposeEntryType =
  | "placeVisit"
  | "flight"
  | "lodgingStay"
  | "railJourney"
  | "busJourney"
  | "ferryJourney"
  | "rentalBooking"
  | "cruise"
  | "tripRoute";

export interface VisibilityState {
  visibility: PurposeVisibility;
  /** Changes whenever the setting changes (also `X-Purpose-Visibility` on scoped reads). */
  revision: string;
}

export const purposeApi = {
  set: async (type: PurposeEntryType, id: string, purpose: Purpose | null) => {
    const { data } = await api.put<Envelope<{ purpose: Purpose | null }>>(
      `/purpose/entries/${type}/${id}`,
      { purpose }
    );
    return data.data.purpose;
  },

  visibility: async (): Promise<VisibilityState> => {
    const { data } = await api.get<Envelope<VisibilityState>>("/purpose/visibility");
    return data.data;
  },

  setVisibility: async (visibility: PurposeVisibility): Promise<VisibilityState> => {
    const { data } = await api.put<Envelope<VisibilityState>>("/purpose/visibility", visibility);
    return data.data;
  },

  hidden: async (): Promise<Partial<Record<PurposeDomain, Record<string, number>>>> => {
    const { data } =
      await api.get<Envelope<{ hidden: Partial<Record<PurposeDomain, Record<string, number>>> }>>(
        "/purpose/hidden"
      );
    return data.data.hidden;
  },

  applyToTrip: async (
    tripId: string,
    purpose?: Purpose
  ): Promise<{ purpose: Purpose | null; changed: number }> => {
    const { data } = await api.post<Envelope<{ purpose: Purpose | null; changed: number }>>(
      `/purpose/trips/${tripId}/apply`,
      purpose ? { purpose } : {}
    );
    return data.data;
  },

  /** What `applyToTrip` would change, without writing (UAT rc.45: ask first, with the count). */
  previewTrip: async (
    tripId: string
  ): Promise<{ purpose: Purpose | null; wouldChange: number }> => {
    const { data } = await api.get<Envelope<{ purpose: Purpose | null; wouldChange: number }>>(
      `/purpose/trips/${tripId}/apply`
    );
    return data.data;
  },

  fillFromTrips: async (): Promise<number> => {
    const { data } = await api.post<Envelope<{ changed: number }>>("/purpose/from-trips");
    return data.data.changed;
  },
};
