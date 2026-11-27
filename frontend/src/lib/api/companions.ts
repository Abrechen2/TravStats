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
  /** The person on another server this companion is (a connection id); absent on older servers. */
  linkedRemoteId?: string | null;
  /** Entries per kind the user sees, planned ones included. */
  uses: Partial<Record<CompanionUseKind, number>>;
  /** Entries in domains switched off — they still keep the companion from a delete. */
  hiddenUses: number;
  expensesPaid: number;
  /** Documents assigned to this person (document-links D7); a delete hands them back to the owner. */
  documents?: number;
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

/** A shared entry named by the first / last journey; `href` is the editable record. */
export interface CompanionJourney {
  day: string;
  kind: CompanionUseKind;
  id: string;
  href: string | null;
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
  /** Km of the shared flights with a known distance; null when none has one, never 0. */
  flightKm: number | null;
  firstJourney: CompanionJourney | null;
  lastJourney: CompanionJourney | null;
}

/** `{ key, values } | { text }` of an entry, as the evidence panel's contract has it. */
export type PersonLabel =
  { key: string; values?: Record<string, string | number> } | { text: string };

export interface PersonTimelineRow {
  kind: CompanionUseKind;
  id: string;
  href: string | null;
  title: PersonLabel;
  subtitle: PersonLabel | null;
  from: string | null;
  to: string | null;
  state: "happened" | "planned";
}

/** One companion's page — `GET /companions/:id/timeline`. null figures are "unknown", never 0. */
export interface PersonTimeline {
  companion: { id: string; name: string; linkedUser: CompanionPerson | null };
  kinds: CompanionUseKind[];
  summary: {
    firstTogether: string | null;
    lastTogether: string | null;
    firstJourney: CompanionJourney | null;
    lastJourney: CompanionJourney | null;
    entries: number;
    days: number;
    trips: number;
    flights: number | null;
    nights: number | null;
    countries: number | null;
    plannedTrips: number;
  };
  timeline: PersonTimelineRow[];
  documents: Array<{
    id: string;
    name: string | null;
    kind: string | null;
    issuedOn: string | null;
    entry: { kind: CompanionUseKind; id: string; href: string | null };
  }>;
  facts: {
    seats: Array<{
      kind: CompanionUseKind;
      id: string;
      href: string | null;
      title: PersonLabel;
      day: string | null;
      seat: string | null;
      seatClass: string | null;
    }>;
    loyalty: Array<{ number: string; kinds: CompanionUseKind[] }>;
  };
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
  timeline: async (id: string): Promise<PersonTimeline> => {
    const { data } = await api.get<PersonTimeline>(`/companions/${enc(id)}/timeline`);
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
