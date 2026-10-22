import { api } from "./client";

export interface Companion {
  id: string;
  name: string;
  usageCount: number;
}

/** A kind of entry a companion can be on: a domain (a stay names them as text), or a trip (never hidden). */
export type CompanionUseKind =
  "flight" | "trip" | "cruise" | "lodging" | "rail" | "bus" | "ferry" | "rental";

export interface CompanionPerson {
  id: string;
  username: string;
  displayName: string;
}

/** One row of Settings → Mitreisende. */
export interface ManagedCompanion {
  id: string;
  name: string;
  linkedUser: CompanionPerson | null;
  /** Entries per kind the user sees, planned ones included. */
  uses: Partial<Record<CompanionUseKind, number>>;
  /** Entries in domains switched off — they still keep the companion from a delete. */
  hiddenUses: number;
  expensesPaid: number;
  /** `YYYY-MM-DD` of the last day spent together, or null. */
  lastTogether: string | null;
  inUse: boolean;
}

export interface CompanionMergePreview {
  source: { id: string; name: string; linkedUser: CompanionPerson | null };
  target: { id: string; name: string; linkedUser: CompanionPerson | null };
  entries: Partial<Record<CompanionUseKind, { entries: number; shared: number }>>;
  hiddenEntries: number;
  expensesPaid: number;
  renamedLists: number;
  link: "none" | "keepTarget" | "moveToTarget" | "conflict";
  allowed: boolean;
}

/** One row of "Mit wem unterwegs", all time. */
export interface CompanionTogether {
  id: string;
  name: string;
  entries: number;
  perKind: Partial<Record<CompanionUseKind, number>>;
  days: number;
  /** null: no shared entry could prove a country — not zero. */
  countries: number | null;
  lastTogether: string | null;
}

const enc = encodeURIComponent;

// Companion API
export const companionsApi = {
  list: async (): Promise<Companion[]> => {
    const { data } = await api.get<{ companions: Companion[] }>("/companions");
    return data.companions;
  },
  manage: async (): Promise<{ companions: ManagedCompanion[]; kinds: CompanionUseKind[] }> => {
    const { data } = await api.get<{ companions: ManagedCompanion[]; kinds: CompanionUseKind[] }>(
      "/companions/manage"
    );
    return data;
  },
  together: async (): Promise<{ companions: CompanionTogether[]; kinds: CompanionUseKind[] }> => {
    const { data } = await api.get<{ companions: CompanionTogether[]; kinds: CompanionUseKind[] }>(
      "/companions/together"
    );
    return data;
  },
  rename: async (id: string, name: string): Promise<{ id: string; name: string }> => {
    const { data } = await api.patch<{ companion: { id: string; name: string } }>(
      `/companions/${enc(id)}`,
      { name }
    );
    return data.companion;
  },
  mergePreview: async (id: string, into: string): Promise<CompanionMergePreview> => {
    const { data } = await api.get<{ preview: CompanionMergePreview }>(
      `/companions/${enc(id)}/merge-preview`,
      { params: { into } }
    );
    return data.preview;
  },
  merge: async (id: string, into: string): Promise<CompanionMergePreview> => {
    const { data } = await api.post<{ merged: CompanionMergePreview }>(
      `/companions/${enc(id)}/merge`,
      { into }
    );
    return data.merged;
  },
  remove: async (id: string): Promise<void> => {
    await api.delete(`/companions/${enc(id)}`);
  },
  deleteUnused: async (): Promise<number> => {
    const { data } = await api.post<{ deleted: number }>("/companions/delete-unused");
    return data.deleted;
  },
};
