import { api } from "./client";

/** The ship behind a ferry crossing or a cruise (2026-11-22), `routes/vessel/vesselRoutes.ts`. */
export type VesselKind = "ferry" | "cruise";
export type VesselSignal = "notConfigured" | "unresolved" | "notInProgress" | "ok" | "outOfRange";
export type VesselSource = "catalogue" | "wikidata" | "aisstream" | "manual";

export interface VesselStatus {
  vesselName: string | null;
  mmsi: string | null;
  source: VesselSource | null;
  confidence: "high" | "medium" | null;
  reason: "ambiguous" | "notFound" | "unavailable" | "noName" | null;
  aisConfigured: boolean;
  inProgress: boolean;
  signal: VesselSignal;
  lastFix: {
    lat: number;
    lon: number;
    observedAt: string;
    receivedAt: string;
    speedKnots: number | null;
    courseDegrees: number | null;
  } | null;
  track: {
    coordinates: Array<[number, number]>;
    distanceKm: number;
    coversJourney: boolean;
    firstAt: string;
    lastAt: string;
  } | null;
}

export interface VesselCandidate {
  mmsi: string;
  imo: string | null;
  name: string;
  operator: string | null;
  source: Exclude<VesselSource, "manual">;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

const base = (kind: VesselKind, id: string) =>
  `/${kind === "ferry" ? "ferry" : "cruises"}/${encodeURIComponent(id)}/vessel`;

export const vesselApi = {
  async status(kind: VesselKind, id: string): Promise<VesselStatus> {
    return (await api.get<Envelope<VesselStatus>>(base(kind, id), { timeout: 30000 })).data.data;
  },
  async candidates(
    kind: VesselKind,
    id: string,
    q: string
  ): Promise<{ status: "ok" | "unavailable"; candidates: VesselCandidate[] }> {
    return (
      await api.get<Envelope<{ status: "ok" | "unavailable"; candidates: VesselCandidate[] }>>(
        `${base(kind, id)}/candidates`,
        { params: { q }, timeout: 30000 }
      )
    ).data.data;
  },
  async assign(kind: VesselKind, id: string, mmsi: string, query: string): Promise<void> {
    await api.put(base(kind, id), { mmsi, query });
  },
};
