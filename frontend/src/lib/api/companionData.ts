import axios from "axios";
import { api } from "./client";

/**
 * What the Companion writes to the server and the web now shows (forgejo#398):
 * a trip's packing list, the home place and the passport's expiry. Bare
 * responses; the contract is `backend/src/routes/trips/tripPacking.ts` and
 * `routes/settings/personal.ts`.
 */

/** `{server, subjectId}` of a person; the web only passes it through. */
export interface PackingPrincipal {
  server: string;
  subjectId: string;
}

/**
 * One item of the single packing store, rich shape (`?shape=rich`, forgejo#398).
 * `done` is what TravPlan calls `packed`. A write sends every field back as it
 * was read: a field the web leaves out would be reset to its default.
 */
export interface PackingItem {
  id: string;
  label: string;
  done: boolean;
  category: string;
  quantity: number;
  scope: "personal" | "shared";
  note: string;
  manual: boolean;
  ownerPrincipal: PackingPrincipal | null;
  assigneePrincipal: PackingPrincipal | null;
}

export const PACKING_MAX_CATEGORY = 40;
export const PACKING_MAX_QUANTITY = 100;

/** A new item with the store's defaults. */
export function newPackingItem(
  label: string,
  extra: Partial<Pick<PackingItem, "category" | "quantity" | "scope">> = {}
): PackingItem {
  return {
    id: newMutationId(),
    label,
    done: false,
    category: "",
    quantity: 1,
    scope: "personal",
    note: "",
    manual: true,
    ownerPrincipal: null,
    assigneePrincipal: null,
    ...extra,
  };
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
    const { data } = await api.get<PackingList>(`/trips/${tripId}/packing`, {
      params: { shape: "rich" },
    });
    return data;
  },
  put: async (
    tripId: string,
    items: PackingItem[],
    baseRev: number,
    mutationId: string
  ): Promise<PackingList> => {
    const { data } = await api.put<PackingList>(
      `/trips/${tripId}/packing`,
      { items, baseRev, mutationId },
      { params: { shape: "rich" } }
    );
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
