import type { TimeValue } from "../../shared/time/wire";
import { api } from "./client";
import { waitForJob } from "./jobs";
export interface StayScanState {
  enabled: boolean;
  connected: boolean;
  result: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  dataThrough: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  pointCount: number;
  createdCount: number;
}
export interface DawarichStay {
  times?: Record<
    "startAt" | "endAt" | "sourceStartAt" | "sourceEndAt" | "detectedAt" | "resolvedAt",
    TimeValue | null
  >;
  id: string;
  status: "pending" | "accepted" | "rejected";
  name: string | null;
  startAt: string;
  endAt: string;
  zone: string;
  lat: number;
  lon: number;
  sourceStartAt: string;
  sourceEndAt: string;
  sourceLat: number;
  sourceLon: number;
  pointCount: number;
  placeId: string | null;
  tripId: string | null;
  visitId: string | null;
  visit: { id: string; placeId: string } | null;
  detectedAt: string;
  resolvedAt: string | null;
  evidence: {
    source: "dawarich";
    matchingVisitId?: string | null;
    zone: string;
    pointIds: number[];
    maxGapMinutes: number;
    uncertainties: string[];
  };
}
export interface StayChoices {
  places: { id: string; name: string; lat: number; lon: number }[];
  trips: { id: string; name: string }[];
}
export interface StayReviewInput {
  name: string;
  placeId: string | null;
  tripId: string | null;
  lat: number;
  lon: number;
  startAt: { local: string };
  endAt: { local: string };
}
const base = "/dawarich-stays";
export const dawarichStaysApi = {
  state: async (): Promise<StayScanState> => (await api.get(`${base}/settings`)).data.data,
  enable: async (enabled: boolean): Promise<void> => {
    await api.patch(`${base}/settings`, { enabled });
  },
  scan: async (): Promise<void> => {
    const { data } = await api.post(`${base}/scan`, {});
    await waitForJob(data.data.jobId);
  },
  list: async (status: string): Promise<DawarichStay[]> =>
    (await api.get(base, { params: { status } })).data.data,
  choices: async (): Promise<StayChoices> => (await api.get(`${base}/choices`)).data.data,
  accept: async (id: string, input: StayReviewInput): Promise<void> => {
    await api.post(`${base}/${id}/accept`, input);
  },
  reject: async (id: string): Promise<void> => {
    await api.post(`${base}/${id}/reject`, {});
  },
};
