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

/** A purpose as written: the kind alone (`private` | `business`) or a key (`builtin:…`, `custom:…`). */
export type PurposeValue = string;

export interface StoredPurpose {
  purpose: Purpose | null;
  purposeKey: string | null;
}

export interface BuiltinPurposeEntry {
  key: string;
  kind: Purpose;
  icon: string;
  color: string;
  label: { de: string; en: string };
}

export interface CustomPurposeEntry {
  key: string;
  id: string;
  name: string;
  nameEn: string | null;
  kind: Purpose;
  color: string;
  icon: string;
  archived: boolean;
  usage: number;
}

export interface PurposeCatalogue {
  builtins: BuiltinPurposeEntry[];
  custom: CustomPurposeEntry[];
  /** Client-side: false until the account's own purposes arrived (a custom key is then trusted). */
  loaded?: boolean;
}

export interface CustomPurposeInput {
  name: string;
  nameEn?: string | null;
  kind: Purpose;
  color: string;
  icon: string;
}

export const purposeApi = {
  set: async (
    type: PurposeEntryType,
    id: string,
    purpose: PurposeValue | null
  ): Promise<StoredPurpose> => {
    const { data } = await api.put<Envelope<StoredPurpose>>(`/purpose/entries/${type}/${id}`, {
      purpose,
    });
    return { purpose: data.data.purpose, purposeKey: data.data.purposeKey ?? null };
  },

  /** Entries per domain and effective purpose key (`unknown`: no purpose), for the filter. */
  usage: async (): Promise<Partial<Record<PurposeDomain, Record<string, number>>>> => {
    const { data } =
      await api.get<Envelope<{ usage: Partial<Record<PurposeDomain, Record<string, number>>> }>>(
        "/purpose/usage"
      );
    return data.data.usage;
  },

  catalogue: async (): Promise<PurposeCatalogue> => {
    const { data } = await api.get<Envelope<PurposeCatalogue>>("/purpose/catalogue");
    return data.data;
  },

  createCustom: async (input: CustomPurposeInput): Promise<CustomPurposeEntry> => {
    const { data } = await api.post<Envelope<CustomPurposeEntry>>("/purpose/custom", input);
    return data.data;
  },

  updateCustom: async (
    id: string,
    input: Partial<CustomPurposeInput> & { archived?: boolean }
  ): Promise<CustomPurposeEntry> => {
    const { data } = await api.patch<Envelope<CustomPurposeEntry>>(`/purpose/custom/${id}`, input);
    return data.data;
  },

  deleteCustom: async (id: string): Promise<void> => {
    await api.delete(`/purpose/custom/${id}`);
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
    purpose?: PurposeValue
  ): Promise<StoredPurpose & { changed: number }> => {
    const { data } = await api.post<Envelope<StoredPurpose & { changed: number }>>(
      `/purpose/trips/${tripId}/apply`,
      purpose ? { purpose } : {}
    );
    return data.data;
  },

  /** What `applyToTrip` would change, without writing (UAT rc.45: ask first, with the count). */
  previewTrip: async (
    tripId: string,
    purpose?: PurposeValue
  ): Promise<StoredPurpose & { wouldChange: number }> => {
    const { data } = await api.get<Envelope<StoredPurpose & { wouldChange: number }>>(
      `/purpose/trips/${tripId}/apply`,
      purpose ? { params: { purpose } } : undefined
    );
    return data.data;
  },

  fillFromTrips: async (): Promise<number> => {
    const { data } = await api.post<Envelope<{ changed: number }>>("/purpose/from-trips");
    return data.data.changed;
  },
};
