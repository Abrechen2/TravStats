import { api } from "./client";
import type { PackageReading } from "./parse";

/**
 * Package tour → trip (plan 2026-10-09 P3). Mirrors the backend's
 * `services/trip/package/types.ts`; the server builds the proposal and writes
 * it — this client never creates the entities one by one.
 */
export type PackageEntityAction = "create" | "attach" | "skip";
export type PackageProposalReason =
  "duplicate" | "onOtherTrip" | "unresolvedAirport" | "excluded" | "undated";
export type PackageWarningCode =
  | "airportAmbiguous"
  | "airportUnknown"
  | "priceConflict"
  | "flightOnOtherTrip"
  | "stayOnOtherTrip"
  | "cruiseUndated"
  | "documentFiledElsewhere";

export interface PackageAirportCandidate {
  iata: string;
  name: string;
  city: string | null;
}

export interface PackageEndpoint {
  iata: string | null;
  city: string | null;
  status: "given" | "resolved" | "chosen" | "ambiguous" | "unknown";
  candidates?: PackageAirportCandidate[];
}

export interface PackageProposalFlight {
  index: number;
  action: PackageEntityAction;
  id: string | null;
  reason?: PackageProposalReason;
  flightNumber: string;
  airline: string | null;
  date: string;
  depTime: string | null;
  arrTime: string | null;
  arrDayOffset: number;
  departure: PackageEndpoint;
  arrival: PackageEndpoint;
}

export interface PackageProposalStay {
  index: number;
  action: PackageEntityAction;
  id: string | null;
  reason?: PackageProposalReason;
  lodging: { action: "create" | "reuse"; id: string | null };
  name: string;
  checkIn: string;
  checkOut: string;
  address: string | null;
  city: string | null;
  country: string | null;
  board: string | null;
  room: string | null;
}

export interface PackageProposal {
  trip: {
    action: "create" | "attach";
    id: string | null;
    name: string;
    startDate: string | null;
    endDate: string | null;
    matchedBy: "bookingReference" | "dateOverlap" | null;
  };
  booking: {
    action: "create" | "attach";
    id: string | null;
    reference: string;
    issuedOn: string;
    price: number | null;
    currency: string | null;
    travellers: number | null;
    storedPrice?: { price: number | null; currency: string | null };
  };
  flights: PackageProposalFlight[];
  stays: PackageProposalStay[];
  cruise: {
    action: PackageEntityAction;
    id: string | null;
    reason?: PackageProposalReason;
    ship: string | null;
    from: string | null;
    to: string | null;
    cabin: string | null;
    startDate: string | null;
    endDate: string | null;
  } | null;
  document: {
    id: string;
    action: "file" | "skip";
    reason?: "alreadyOnTrip" | "filedElsewhere";
  } | null;
  warnings: Array<{ code: PackageWarningCode; subject: string }>;
}

export interface PackageChoices {
  /** Place name as the document wrote it → the IATA code the reviewer picked. */
  airports?: Record<string, string>;
  tripName?: string;
  excludeFlights?: number[];
  excludeStays?: number[];
  excludeCruise?: boolean;
}

export interface PackageRequest {
  reading?: PackageReading;
  documentId?: string;
  choices?: PackageChoices;
}

export interface PackageCommitResult {
  trip: { action: "create" | "attach"; id: string };
  booking: { action: "create" | "attach"; id: string };
  flights: Array<{ index: number; action: PackageEntityAction; id: string | null }>;
  stays: Array<{ index: number; action: PackageEntityAction; id: string | null }>;
  cruise: { action: PackageEntityAction; id: string | null } | null;
  document: { id: string; action: "file" | "skip" } | null;
  proposal: PackageProposal;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

export const tripPackageApi = {
  preview: async (request: PackageRequest): Promise<PackageProposal> => {
    const { data } = await api.post<Envelope<{ proposal: PackageProposal }>>(
      "/trips/package/preview",
      request
    );
    return data.data.proposal;
  },
  commit: async (request: PackageRequest): Promise<PackageCommitResult> => {
    const { data } = await api.post<Envelope<PackageCommitResult>>(
      "/trips/package/commit",
      request
    );
    return data.data;
  },
};
