import { isAxiosError } from "axios";
import { api } from "./client";

export interface FederationPeer {
  origin: string;
  fingerprint: string;
  enabled: boolean;
  verifiedAt: string | null;
  /** Leaderboard snapshot versions the peer serves; empty = its server needs an update. */
  leaderboardVersions: number[];
}

export interface FederationState {
  source: "env" | "settings" | null;
  enabled: boolean;
  origin: string | null;
  publicKey: string | null;
  fingerprint: string | null;
  /** The admin's switch for trip sharing across servers (default off). */
  tripSharingEnabled: boolean;
  peers: FederationPeer[];
}

const BASE = "/admin/federation";

export const federationAdminApi = {
  get: async (): Promise<FederationState> => (await api.get<FederationState>(BASE)).data,
  update: async (body: { enabled: boolean; origin: string }): Promise<FederationState> =>
    (await api.put<FederationState>(BASE, body)).data,
  setTripSharing: async (enabled: boolean): Promise<FederationState> =>
    (await api.put<FederationState>(`${BASE}/trip-sharing`, { enabled })).data,
  generateKey: async (): Promise<FederationState> =>
    (await api.post<FederationState>(`${BASE}/key`)).data,
  pinPeer: async (body: {
    origin: string;
    publicKey: string;
    fingerprint: string;
    enabled: boolean;
  }): Promise<FederationState> => (await api.post<FederationState>(`${BASE}/peers`, body)).data,
  verifyPeer: async (origin: string): Promise<void> => {
    await api.post(`${BASE}/peers/verify`, { origin });
  },
  suspendPeer: async (origin: string): Promise<void> => {
    await api.post(`${BASE}/peers/suspend`, { origin });
  },
};

/** Refusal codes the admin federation API sends; each has its own copy. */
const FEDERATION_ERROR_CODES = [
  "COMPARISON_PEER_KEY_INVALID",
  "COMPARISON_PEER_UNREACHABLE",
  "COMPARISON_PEER_UNKNOWN",
  "COMPARISON_FEDERATION_ENV",
] as const;

export type FederationErrorCode = (typeof FEDERATION_ERROR_CODES)[number];

/** The refusal code of a failed admin federation call, or null for anything else. */
export function federationErrorCode(error: unknown): FederationErrorCode | null {
  if (!isAxiosError(error)) return null;
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return FEDERATION_ERROR_CODES.find((known) => known === code) ?? null;
}
