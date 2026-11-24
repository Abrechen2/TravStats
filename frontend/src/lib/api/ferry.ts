import type { FerryTicketPreview } from "../../components/ferry/FerryTicketImport";
import { api } from "./client";
import type { FerryStationDraft } from "../../components/ferry/FerryStationField";
import type { FerryJourney, FerryStatus } from "../../types/ferry";
interface Envelope<T> {
  success: boolean;
  data: T;
}
export interface FerryRoadtripLeg {
  id: string;
  mode: string;
  ferryJourney: { id: string } | null;
  fromStop: { title: string };
  toStop: { title: string };
  route: { name: string; tripId: string | null };
}
/** What a save did to the crossing's sea line: `failed` = saved, but routing failed. */
export type FerrySeaRouteOutcome = "routed" | "straight" | "unchanged" | "failed";
/** `pair`: every crossing between the same two ports, both directions; `journey`: this one only. */
export type FerryLineScope = "pair" | "journey";
export interface FerryPairReach {
  count: number;
  from: string;
  to: string;
  hasPairLine: boolean;
}
export interface FerryListSummary {
  journeys: number;
  operators: number;
  withoutOperator: number;
  stations: number;
}

export interface FerryPage {
  journeys: FerryJourney[];
  total: number;
  summary: FerryListSummary;
}

export interface FerryListQuery {
  q?: string;
  year?: number;
  /** 1-12, with `year`. */
  month?: number;
  status?: string;
  tripId?: string;
  sort?: "departure" | "distance" | "created";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/** The write body of POST/PATCH /ferry; a PATCH carries only what changed. */
export interface FerryJourneyInput {
  documentIds?: string[];
  departureStation?: FerryStationDraft;
  arrivalStation?: FerryStationDraft;
  departureLocal?: string;
  arrivalLocal?: string | null;
  departureFold?: string;
  arrivalFold?: string;
  tripId?: string | null;
  companions?: string[];
  tags?: string[];
  status?: FerryStatus;
  operator?: string | null;
  vesselName?: string | null;
  bookingReference?: string | null;
  ticketReference?: string | null;
  vehicleType?: string | null;
  vehicleRegistration?: string | null;
  cabinType?: string | null;
  fareClass?: string | null;
  seat?: string | null;
  currency?: string | null;
  notes?: string | null;
  passengerCount?: number | null;
  vehicleLengthM?: number | null;
  vehicleWidthM?: number | null;
  vehicleHeightM?: number | null;
  price?: number | null;
  distanceKm?: number | null;
}

export const ferryApi = {
  async route(id: string) {
    return (
      await api.post<Envelope<{ outcome: "routed" | "straight" | "unchanged" }>>(
        `/ferry/${encodeURIComponent(id)}/route`,
        {},
        { timeout: 60000 }
      )
    ).data.data;
  },
  /** Draw the crossing's route by hand: `[lon, lat]` points, both ends on the terminals (forgejo#431). */
  async setManualRoute(
    id: string,
    waypoints: Array<[number, number]>,
    baseVersion?: string,
    scope: FerryLineScope = "pair"
  ) {
    return (
      await api.put<Envelope<FerryJourney>>(`/ferry/${encodeURIComponent(id)}/route-override`, {
        waypoints,
        scope,
        ...(baseVersion ? { baseVersion } : {}),
      })
    ).data.data;
  },
  /** How many of the user's crossings a pair line drawn here would reach (this one included). */
  async routePair(id: string): Promise<FerryPairReach> {
    return (await api.get<Envelope<FerryPairReach>>(`/ferry/${encodeURIComponent(id)}/route-pair`))
      .data.data;
  },
  /** Drop the hand-drawn line; the server routes the crossing again where it can. */
  async clearManualRoute(id: string, baseVersion?: string, scope: "all" | "journey" = "all") {
    return (
      await api.delete<
        Envelope<FerryJourney> & { meta: { seaRoute: "routed" | "straight" | "unchanged" } }
      >(`/ferry/${encodeURIComponent(id)}/route-override`, {
        timeout: 60000,
        params: { scope },
        ...(baseVersion ? { headers: { "If-Match": `"${baseVersion}"` } } : {}),
      })
    ).data;
  },
  async ticketPreview(
    input: { text: string } | { documentId: string },
    headers?: Record<string, string>
  ): Promise<FerryTicketPreview> {
    return (
      await api.post<Envelope<FerryTicketPreview>>("/ferry/ticket-preview", input, {
        timeout: 180000,
        ...(headers ? { headers } : {}),
      })
    ).data.data;
  },
  /** The picker's legs, newest first; `truncated` when older ones were left out. */
  async roadtripLegs(): Promise<{ legs: FerryRoadtripLeg[]; truncated: boolean }> {
    const res = await api.get<Envelope<FerryRoadtripLeg[]> & { meta?: { truncated?: boolean } }>(
      "/ferry/roadtrip-legs"
    );
    return { legs: res.data.data, truncated: res.data.meta?.truncated === true };
  },
  async linkLeg(id: string, legId: string | null) {
    await api.put(`/ferry/${encodeURIComponent(id)}/roadtrip-leg`, { legId });
  },
  async list(query: FerryListQuery = {}): Promise<FerryPage> {
    const res = await api.get<
      Envelope<FerryJourney[]> & { meta: { total: number; summary: FerryListSummary } }
    >("/ferry", { params: query });
    return { journeys: res.data.data, total: res.data.meta.total, summary: res.data.meta.summary };
  },

  /** Every ride matching `query`, a page of 500 (the endpoint's cap) at a time. */
  async listAll(query: Omit<FerryListQuery, "limit" | "offset"> = {}): Promise<FerryJourney[]> {
    const PAGE = 500;
    const rides: FerryJourney[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await ferryApi.list({ ...query, limit: PAGE, offset });
      rides.push(...page.journeys);
      if (page.journeys.length < PAGE || rides.length >= page.total) return rides;
    }
  },

  async get(id: string) {
    return (await api.get<Envelope<FerryJourney>>(`/ferry/${encodeURIComponent(id)}`)).data.data;
  },
  async save(id: string | null, input: FerryJourneyInput) {
    return (await ferryApi.saveReported(id, input)).ride;
  },
  /** A save, with what it did to the sea line (`meta.seaRoute`, forgejo#323). */
  async saveReported(
    id: string | null,
    input: FerryJourneyInput
  ): Promise<{ ride: FerryJourney; seaRoute: FerrySeaRouteOutcome | null }> {
    type Saved = Envelope<FerryJourney> & { meta?: { seaRoute?: FerrySeaRouteOutcome } };
    const response = id
      ? await api.patch<Saved>(`/ferry/${encodeURIComponent(id)}`, input)
      : await api.post<Saved>("/ferry", input);
    return { ride: response.data.data, seaRoute: response.data.meta?.seaRoute ?? null };
  },
  async remove(id: string) {
    await api.delete(`/ferry/${encodeURIComponent(id)}`);
  },
};
