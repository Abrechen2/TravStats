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

/** What the server read from another server's connection file. Nothing is pinned yet. */
export interface ConnectionFileInspection {
  origin: string;
  publicKey: string;
  fingerprint: string;
  /** That server is already pinned; `sameKey` false means the file replaces its key. */
  existingPeer: { fingerprint: string; sameKey: boolean } | null;
}

const BASE = "/admin/federation";

/** FileReader rather than `Blob.text()`, which not every runtime (jsdom among them) has. */
const blobText = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

/**
 * A blob request's error body arrives as a Blob too, so its `code` would be invisible to
 * `federationErrorCode`. Read it back into JSON before the caller sees the error.
 */
async function withJsonErrorBody(error: unknown): Promise<never> {
  const data: unknown = isAxiosError(error) ? error.response?.data : undefined;
  if (isAxiosError(error) && error.response && data instanceof Blob) {
    try {
      error.response.data = JSON.parse(await blobText(data));
    } catch {
      // Not JSON: the error stays codeless and reads as the generic failure.
    }
  }
  throw error;
}

/** The server's own name for the file, from `Content-Disposition`. */
function attachmentName(header: unknown): string {
  const match = typeof header === "string" ? /filename="([^"]+)"/.exec(header) : null;
  return match?.[1] ?? "travstats-verbindung.zip";
}

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
  downloadConnectionFile: async (): Promise<{ blob: Blob; filename: string }> => {
    try {
      const res = await api.get<Blob>(`${BASE}/connection-file`, { responseType: "blob" });
      return { blob: res.data, filename: attachmentName(res.headers["content-disposition"]) };
    } catch (error) {
      return withJsonErrorBody(error);
    }
  },
  /** Reads the file on the server; pins nothing. */
  inspectConnectionFile: async (file: File): Promise<ConnectionFileInspection> => {
    const form = new FormData();
    form.append("file", file);
    // The shared client sends JSON by default; naming multipart lets axios add the boundary.
    return (
      await api.post<ConnectionFileInspection>(`${BASE}/connection-file/inspect`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      })
    ).data;
  },
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
  "COMPARISON_FEDERATION_OFF",
  "COMPARISON_CONNECTION_FILE_UNREADABLE",
  "COMPARISON_CONNECTION_FILE_TOO_LARGE",
  "COMPARISON_CONNECTION_FILE_FORMAT",
  "COMPARISON_CONNECTION_FILE_ORIGIN",
  "COMPARISON_CONNECTION_FILE_KEY",
  "COMPARISON_CONNECTION_FILE_FINGERPRINT",
  "COMPARISON_CONNECTION_FILE_SELF",
] as const;

export type FederationErrorCode = (typeof FEDERATION_ERROR_CODES)[number];

/** The refusal code of a failed admin federation call, or null for anything else. */
export function federationErrorCode(error: unknown): FederationErrorCode | null {
  if (!isAxiosError(error)) return null;
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return FEDERATION_ERROR_CODES.find((known) => known === code) ?? null;
}
