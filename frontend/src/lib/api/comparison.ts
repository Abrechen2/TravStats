import { api } from "./client";
export interface Scope {
  statistics: boolean;
  details: boolean;
  costs: boolean;
  personal: boolean;
  photos: boolean;
  documents: boolean;
  domains: string[];
  tripIds: string[];
  futureTrips: boolean;
  year: number | null;
  precision: "exact" | "rounded";
  expiresAt: string | null;
}
export interface Link {
  id: string;
  channel: string;
  origin: string;
  label: string;
  confirmed: boolean;
  remoteConfirmed: boolean;
  code: string;
  grants: Array<{ audience: string; active: boolean; revision: number; scope: Scope }>;
}
export interface Snapshot {
  version: 1;
  definition: string;
  asOf: string;
  year: number | null;
  precision: "exact" | "rounded";
  coverage: "all" | "selection";
  domains: string[];
  currency: string;
  metrics: Partial<
    Record<
      | "cruises"
      | "cruiseDistance"
      | "cruisePorts"
      | "stays"
      | "nights"
      | "railRides"
      | "railTicketKm"
      | "railTracedKm"
      | "railStraightKm"
      | "busRides"
      | "busTicketKm"
      | "busRouteKm"
      | "rentals"
      | "rentalDays"
      | "rentalKm",
      number | null
    >
  > &
    Record<"flights" | "distance" | "minutes" | "countries" | "daysAway" | "cost", number | null>;
  details: boolean;
  trips: Array<{ id: string; name: string }>;
}
/** One domain of a consent preview, cut from the same projection a grant publishes. */
export interface RecordPage {
  domain: string;
  nextCursor: null;
  rows: Array<{
    key: string;
    fields: Array<{ name: string; value: string | number | boolean | null }>;
  }>;
}
export interface Board {
  id: string;
  name: string;
  channels: string[];
  version: number;
}
export interface Peer {
  origin: string;
  publicKey: string;
  enabled: boolean;
  verifiedAt: string | null;
}
export interface PeerState {
  local: { origin: string; publicKey: string; fingerprint: string } | null;
  peers: Peer[];
}
export async function comparisonGet<T>(path: string): Promise<T> {
  return (await api.get<{ success: true; data: T }>(`/comparison${path}`)).data.data;
}
export async function comparisonPost<T>(path: string, body: unknown = {}): Promise<T> {
  return (await api.post<{ success: true; data: T }>(`/comparison${path}`, body)).data.data;
}
export async function comparisonDelete(path: string): Promise<void> {
  await api.delete(`/comparison${path}`);
}
export interface Circle {
  id: string;
  name: string;
  version: number;
  linkId: string | null;
  host: string;
  members: Array<{ channel: string; label: string; origin: string; accepted: boolean }>;
}

export const COMPARISON_METRICS = [
  "flights",
  "distance",
  "minutes",
  "countries",
  "daysAway",
  "cost",
  "cruises",
  "cruiseDistance",
  "cruisePorts",
  "stays",
  "nights",
  "railRides",
  "railTicketKm",
  "railTracedKm",
  "railStraightKm",
  "busRides",
  "busTicketKm",
  "busRouteKm",
  "rentals",
  "rentalDays",
  "rentalKm",
] as const;
