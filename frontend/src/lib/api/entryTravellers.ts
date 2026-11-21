import { api } from "./client";

/** Mirrors `TRAVELLER_ENTRY_TYPES` in backend/src/services/companions/travellerFacts.ts. */
export const TRAVELLER_ENTRY_TYPES = [
  "flight",
  "cruise",
  "lodgingStay",
  "railJourney",
  "busJourney",
  "ferryJourney",
  "rentalBooking",
] as const;
export type TravellerEntryType = (typeof TRAVELLER_ENTRY_TYPES)[number];

export function isTravellerEntryType(type: string): type is TravellerEntryType {
  return (TRAVELLER_ENTRY_TYPES as readonly string[]).includes(type);
}

export type FactValue = string | boolean | null;

export interface EntryTraveller {
  companionId: string;
  displayName: string;
  position: number;
  /** The entry type's own fields only; null = not recorded. */
  facts: Record<string, FactValue>;
  factsSource: "user" | "auto" | null;
  documents: Array<{ id: string; displayName: string; kind: string | null }>;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

export const entryTravellersApi = {
  list: async (type: TravellerEntryType, id: string): Promise<EntryTraveller[]> => {
    const { data } = await api.get<Envelope<EntryTraveller[]>>("/entry-travellers", {
      params: { entryType: type, entryId: id },
    });
    return data.data;
  },

  /** A patch: fields left out stay, null or "" clears one. */
  setFacts: async (
    type: TravellerEntryType,
    id: string,
    companionId: string,
    facts: Record<string, FactValue>
  ): Promise<EntryTraveller> => {
    const { data } = await api.put<Envelope<EntryTraveller>>(`/entry-travellers/${companionId}`, {
      entry: { type, id },
      facts,
    });
    return data.data;
  },
};

const SEATED = [
  "seatNumber",
  "seatClass",
  "ticketNumber",
  "bookingReference",
  "loyaltyNumber",
] as const;

/** The facts an entry type carries, in display order. Mirrors `TRAVELLER_SPECS` on the server. */
export const TRAVELLER_FACT_FIELDS: Record<
  TravellerEntryType,
  { text: readonly string[]; flags: readonly string[] }
> = {
  flight: { text: SEATED, flags: [] },
  railJourney: { text: SEATED, flags: [] },
  busJourney: { text: SEATED, flags: [] },
  ferryJourney: { text: SEATED, flags: [] },
  cruise: { text: ["cabin", "bookingReference", "loyaltyNumber"], flags: [] },
  rentalBooking: { text: ["bookingReference", "loyaltyNumber"], flags: ["isDriver"] },
  lodgingStay: { text: ["bookingReference", "loyaltyNumber"], flags: [] },
};
