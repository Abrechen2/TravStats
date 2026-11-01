import axios from "axios";
import { api } from "./client";

/**
 * What the Companion writes to the server and the web now shows (forgejo#398):
 * a trip's packing list, the home place and the passport's expiry. Bare
 * responses; the contract is `backend/src/routes/trips/tripPacking.ts` and
 * `routes/settings/personal.ts`.
 */

export interface PackingItem {
  id: string;
  label: string;
  done: boolean;
}

export interface PackingList {
  items: PackingItem[];
  /** 0 = no list stored yet. A write names the rev it started from. */
  rev: number;
  updatedAt: string | null;
}

export const PACKING_MAX_ITEMS = 200;
export const PACKING_MAX_LABEL = 120;

/** A fresh id for a write; a resend after a lost answer must reuse the same one. */
export function newMutationId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The list moved on since it was read (another device wrote first). */
export function isPackingStale(error: unknown): boolean {
  return (
    axios.isAxiosError(error) &&
    error.response?.status === 409 &&
    (error.response.data as { code?: string } | undefined)?.code === "PACKING_LIST_STALE"
  );
}

export const packingApi = {
  get: async (tripId: string): Promise<PackingList> => {
    const { data } = await api.get<PackingList>(`/trips/${tripId}/packing`);
    return data;
  },
  put: async (
    tripId: string,
    items: PackingItem[],
    baseRev: number,
    mutationId: string
  ): Promise<PackingList> => {
    const { data } = await api.put<PackingList>(`/trips/${tripId}/packing`, {
      items,
      baseRev,
      mutationId,
    });
    return data;
  },
};

export interface HomePlace {
  name: string;
  lat: number;
  lon: number;
  zone: string | null;
}

export interface PersonalFacts {
  /** The current home period's residence; the legacy column only without one. */
  homePlace: HomePlace | null;
  /** Where `homePlace` came from. Absent on servers before the home periods were the record. */
  homePlaceSource?: "period" | "legacy";
  /** A calendar day, YYYY-MM-DD. */
  passportExpiry: string | null;
}

export const personalApi = {
  get: async (): Promise<PersonalFacts> => {
    const { data } = await api.get<PersonalFacts>("/settings/personal");
    return data;
  },
  put: async (patch: Partial<PersonalFacts>): Promise<PersonalFacts> => {
    const { data } = await api.put<PersonalFacts>("/settings/personal", patch);
    return data;
  },
};
